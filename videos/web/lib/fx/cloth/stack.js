// STACK (CLOTHING c2, K1): a person dressed from the nude body up. dressPerson(h, outfit) takes an outfit (outfit.js: an ordered stack of
// garments with their fabrics and layering rules) and drapes it on a posed hero, innermost first, each garment against the body, the
// rigid accessories (boots) and every garment already on under it (the GROWN collider), then settles the stack jointly so outer layers
// press inner ones (layers.js), then writes each garment back as its bind-space shape (the CLOTH_REST contract of CLOTHING c1).
// Opt-in: nothing here runs unless dressPerson is called; a hero that is never dressed renders exactly as before.
//
//   const S = await dressPerson(h, outfit, { cache: true })      // S.report: per garment particles, ms, measures; S.crowd(): people.js
//   await S.remove('vest'); await S.add({ id: 'coat', ... });     // undress / redress: re-solves only from the changed garment up
//
// Garments now (outfit.js DESIGNS): the hero's own c1 shells (hero.top, hero.bottom, hero.vest, hero.skirt: they keep their shader cuts,
// collar, rims and pockets, which ride on them), extra shells made on the hero's body for layers c1 could not have (shell.tee,
// shell.shirt: an undershirt under a shirt under a coat), a belt (a ring that holds the trousers' waistband and is a part of its own),
// rigid accessories (hero.boots: in the collider with OUTWARD normals, the c1 bug that buried them), and K2's sewn patterns
// ('pattern:<name>', sew.js). What changes against c1's drapeHero for a shell garment:
//   - the collider is the stack under it (a vest drapes over the shirt instead of being a fixed ceiling; a coat over a shirt over an
//     undershirt), each layer with the compressed-thickness gap and the soft loft band of layers.js;
//   - only the VISIBLE cloth is simulated (the shader's cuts evaluated in JS on the rest shape, plus two rings): a tucked shirt's hidden
//     tail below the waistband rides along instead of being frozen in its shell place and torn between it and the drape (c1's shards);
//   - the waistband, a tucked tail, a rolled cuff and a new shell's yoke are held where they REST on what is under them (a hero top
//     carrying the c7 collar keeps its shell yoke: the collar was built on it);
//   - the joint settle and a last guard keep every inner particle inside the garments over it (reported, not hidden).
// Bakes: each garment's own solve is keyed by its stack prefix (outfit.js stackKeys), the settled stack by the whole stack; in memory
// per hero, on disk (assets/cloth/stack/<key>.bin) when written by labs/clothing2/stack_bake.mjs.
import { Cloth, XPBD_VERSION } from './xpbd.js';
import { SurfaceMesh, Contacts, skinPose, blendInverse, vertexNormals, rigidSurface } from './collide.js';
import { phys } from './fabrics.js';
import * as D from './drape.js';
import { coverSkin } from './skin_cover.js';   // HUMAN c8 HOOKS H3 (opts.skinCover)
import * as LY from './layers.js';
import * as SEW from './sew.js';
import { compileOutfit, stackKeys, dirtyAfter, crowdOf, without, withLayer, OUTFIT_VERSION } from './outfit.js';
export const STACK_VERSION = 1;
const { RG, isArm, isLeg, isTrunk, clamp, sstep, GAP_SKIN, TOP_CUT, LEG_CUT, KNIT } = D;
const now = () => (globalThis.performance ? performance.now() : Date.now()), list = x => [].concat(x || []).filter(Boolean), TAU = Math.PI * 2;
const CULL_RINGS = 4;   // an inner triangle is culled only under outer cloth 4+ rings (~6-8 cm) from its edges (2 left jagged cull lines visible under a lifting hem)
const TAIL_GAP = 0.0025;   // a tucked tail sits closer to the skin than the 4.5 mm c1 keeps a garment off it (the skin under trousers is not drawn)
export const VERSIONS = `S${STACK_VERSION}|X${XPBD_VERSION}|D${D.DRAPE_VERSION}|L${LY.LAYERS_VERSION}|O${OUTFIT_VERSION}|W${SEW.SEW_VERSION}`;

// ---------------------------------------------------------------- the hero's cut parameters (drapeHero's, per garment)
// over: the girth ease (m) of the tops already under this one: outerwear is cut with room for what it goes over (a chore coat's sleeve is
// not 2 cm wider than the shirt sleeve in it); half of the layers' own ease is added to this garment's
function cutKit(h, ctx, { kind, fabric, botFab = null, armEnd = null, over = null }) {
  const fit0 = TOP_CUT[kind] || TOP_CUT.work, fit = over ? { ...fit0, chest: fit0.chest + over.chest / 2, waist: fit0.waist + over.waist / 2, uarm: fit0.uarm + over.uarm / 2, farm: fit0.farm + over.farm / 2 } : fit0, S = ctx.S, H = ctx.H, J = ctx.J;
  const axis = (a, b, sg) => { const A = J(a), B = J(b), d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...d), u = d.map(x => x / l), k = sg * u[0], e = [sg - u[0] * k, -u[1] * k, -u[2] * k], le = Math.hypot(...e) || 1; return { o: A, d: u, len: l, e: e.map(x => x / le) }; };
  const arm = { L: axis('upperarm01.L', 'wrist.L', 1), R: axis('upperarm01.R', 'wrist.R', -1) }, leg = { L: axis('upperleg01.L', 'foot.L', 1), R: axis('upperleg01.R', 'foot.R', -1) }, axes = { arm, leg };
  const yS = J('upperarm01.L')[1] + 0.03, yC = yS - 0.13, yW = ctx.hem('waistY'), yHip = ctx.hem('hipY'), aEnd = armEnd ?? H.armEnd ?? 2, legLen = leg.L.len;
  const kTop = KNIT.has(fabric) ? 0.6 : fabric === 'leather' ? 0.85 : 1, bf = botFab || fabric, lcut = bf === 'denim' ? LEG_CUT.denim : LEG_CUT.work, kLeg = KNIT.has(bf) ? 0.5 : 1;
  const easeArm = lc => { const t = clamp(lc, 0, 2); return kTop * (t < 1 ? fit.uarm * sstep(0, 0.18, t) : fit.uarm + (fit.farm - fit.uarm) * (t - 1)); };
  const easeTrunkTop = y => y > yS ? 0 : kTop * (y > yC ? fit.chest * sstep(yS, yC, y) : fit.chest + (fit.waist - fit.chest) * (1 - fit.straight) * sstep(yC, yW, y));
  const easeLeg = lc => { const t = clamp(lc, 0, 2); return kLeg * (t < 1 ? lcut.seat + (lcut.thigh - lcut.seat) * t : lcut.thigh + (lcut.knee - lcut.thigh) * clamp(t - 1)); };
  const legStraight = G => ['L', 'R'].flatMap(s => [{ sel: D.sel(G, (r, sd) => r === RG.thigh && sd === s), o: leg[s].o, d: leg[s].d, e: leg[s].e, from: legLen * 0.08, ramp: legLen * 0.1, k: lcut.straight },
    { sel: D.sel(G, (r, sd) => (r === RG.shin || r === RG.foot) && sd === s), o: leg[s].o, d: leg[s].d, e: leg[s].e, from: legLen * 0.45, ramp: legLen * 0.1, k: 1 }]);
  const armStraight = G => ['L', 'R'].map(s => ({ sel: D.sel(G, (r, sd) => isArm(r) && sd === s), o: arm[s].o, d: arm[s].d, e: arm[s].e, from: arm[s].len * 0.4, ramp: arm[s].len * 0.2, k: 0.3 }));
  const lengthenTop = (P, AH) => { const fit = K.fit; for (let p = 0; p < P.length / 3; p++) { const r = AH[p * 4];
    if (isTrunk(r) && fit.len && P[p * 3 + 1] < yC && P[p * 3 + 1] > yHip - 0.05) P[p * 3 + 1] -= (yC - P[p * 3 + 1]) * fit.len / Math.max(0.1, yC - yW);
    if (isArm(r) && fit.slv) { const s = AH[p * 4 + 2] > 0 ? 'L' : 'R', w = clamp((AH[p * 4 + 1] - 0.2) / 1.8); for (let c = 0; c < 3; c++) P[p * 3 + c] += arm[s].d[c] * fit.slv * w; } } };
  const lengthenLeg = (P, AH) => { for (let p = 0; p < P.length / 3; p++) { const r = AH[p * 4], x = P[p * 3], y = P[p * 3 + 1];
    if (isLeg(r)) { const s = AH[p * 4 + 2] > 0 ? 'L' : 'R', t = (P[p * 3] - leg[s].o[0]) * leg[s].d[0] + (P[p * 3 + 1] - leg[s].o[1]) * leg[s].d[1] + (P[p * 3 + 2] - leg[s].o[2]) * leg[s].d[2], w = clamp(t / legLen); for (let c = 0; c < 3; c++) P[p * 3 + c] += leg[s].d[c] * lcut.len * w; }
    if (lcut.drop) P[p * 3 + 1] -= lcut.drop * Math.exp(-((x / 0.065) ** 2)) * Math.exp(-(((y - (yHip - 0.05)) / 0.09) ** 2)); } };
  const yokePin = (G, p) => { const r = G.AH[p * 4], y = G.Xb[p * 3 + 1]; return (isTrunk(r) && y > yS - 0.035) || (isArm(r) && G.AH[p * 4 + 1] < 0.05 && y > yS - 0.08); };
  const K = { fit, axes, arm, leg, yS, yC, yW, yHip, armEnd: aEnd, legLen, kTop, lcut, kLeg, easeArm, easeTrunkTop, easeLeg, legStraight, armStraight, lengthenTop, lengthenLeg, yokePin }; return K;
}

// ---------------------------------------------------------------- what of a shell garment is drawn (hero.js's cuts, in JS)
// per mesh vertex: 1 if the cloth shader keeps it (the cuts in hero.js CF_HEAD, on aRest = the undraped bind position and aHero)
export function visibleVerts(m) {
  const g = m.geometry, R = (g.userData.drapeRest || {}).position || g.attributes.position.array, AH = g.attributes.aHero.array, n = R.length / 3, U = m.material.uniforms_c6 || {}, out = new Uint8Array(n);
  const v4 = k => U[k]?.value || { x: 0, y: 0, z: 0, w: 0 }, cHem = v4('cHem'), cHem2 = v4('cHem2'), cVest = v4('cVest'), PT = Math.round(U.cPart?.value ?? 0), c6c = (U.cFoldK?.value || 0) > 0 || (U.cWear?.value || 0) > 0 || (U.cSweat?.value || 0) > 0;
  for (let v = 0; v < n; v++) { const x = R[v * 3], y = R[v * 3 + 1], z = R[v * 3 + 2], reg = AH[v * 4], along = AH[v * 4 + 1], arm = reg > 2.5 && reg < 5.5, leg = reg > 7.5 && reg < 10.5; let ok = true;
    if (PT === 0) { const neck = cHem.w - 0.05 * Math.exp(-((x / 0.035) ** 2)) * (z >= 0 ? 1 : 0); if (arm) ok = along <= cHem.x; else ok = y <= neck && y >= cHem2.y; }
    else if (PT === 1) { const shin = reg > 8.55 && reg < 10.5; if (leg && (shin || !c6c) && along > cHem.y) ok = false; if (!leg && y > cHem2.x) ok = false; }
    else if (PT === 3) { const ax = Math.abs(x); if (y < cVest.w) ok = false; else if (y > cVest.y - 0.02 && ax > cVest.x - 0.045 - 0.05 * sstep(cVest.y, cVest.z, y)) ok = false;
      else { const vneck = cVest.z - 0.2 + 2.2 * Math.max(0, ax - 0.004); if (z > 0 && y > vneck && ax < 0.11) ok = false; else if (y > cVest.z - 0.03 && (ax < 0.055 || ax > 0.145)) ok = false; } }
    out[v] = ok ? 1 : 0; }
  return out;
}

// ---------------------------------------------------------------- garments as meshes on the hero
const RIMKEY = '_stackParent';
// an extra top-like shell on the hero's own body (h._shell + h._addCloth: no hero.js edits; its cuts set on its own uniforms)
function makeShell(h, L) {
  const d = L.d, base = h.body.geometry, P = base.attributes.position.array, AH = base.attributes.aHero.array, idx = base.index.array, H = h.hems, armEnd = 1 + (L.rules?.sleeve ?? d.sleeve ?? 1);
  const neckY = H.neckY + (d.kind === 'tee' ? 0.012 : 0), tuckY = H.tuckY;
  const cov = v => { const r = AH[v * 4], y = P[v * 3 + 1], lc = AH[v * 4 + 1];
    if (r === RG.torso || r === RG.neck) return y < neckY + 0.03; if (r === RG.uarm || r === RG.farm) return armEnd > 0.02 && lc < armEnd + 0.12; if (r === RG.pelvis) return y > tuckY - 0.03; return false; };
  const faces = []; for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2], rs = [AH[a * 4], AH[b * 4], AH[c * 4]];
    if (rs.some(r => r === RG.head || r === RG.jaw)) continue; if (rs.some(r => r === RG.neck) && !(cov(a) && cov(b) && cov(c))) continue; if (cov(a) || cov(b) || cov(c)) faces.push(a, b, c); }
  const g = h._shell(base, faces, d.kind === 'tee' ? 0.008 : 0.012, 'top'), fab = L.fabric || d.fabric;
  const m = h._addCloth(g, { kind: d.kind === 'tee' ? 5 : 0, a: L.color || '#d8d4c8', b: L.color2 || L.color || '#d8d4c8', dirt: (h.o.dirt || 0) * 0.5, part: 0, key: 'top', fab });
  const U = m.material.uniforms_c6; U.cHem.value.x = armEnd; U.cHem.value.w = neckY; U.cHem2.value.y = H.waistY + 0.035;
  if (h._fabDepth) { m.customDepthMaterial = h._fabDepth(m.material); m.castShadow = true; }
  m.userData.stack = L.id; m.userData.part = 'cloth'; return m;
}
function heroMesh(h, L) { const m = h.cloth?.[L.d.key]; return Array.isArray(m) ? null : m || null; }
// the rims, collar and pockets of the c1 garments, each assigned once to the garment it edges (nearest in bind space)
function parentsOfParts(h) {
  if (h._stackParts) return h._stackParts; const C = h.cloth || {}, out = [];
  const heads = ['top', 'bottom', 'vest', 'skirt'].filter(k => C[k] && !Array.isArray(C[k]));
  const near = m => { const R = D.keepRest(m).position; let best = null, bd = Infinity; for (const k of heads) { const d = D.meanNearest(R, D.keepRest(C[k]).position); if (d < bd) { bd = d; best = k; } } return best; };
  if (C.collar) out.push({ m: C.collar, parent: 'top', name: 'collar' }); if (C.pockets) out.push({ m: C.pockets, parent: 'skirt', name: 'pockets' });
  list(C.rims).forEach((r, i) => out.push({ m: r, parent: near(r), name: `rim ${i}` }));
  return (h._stackParts = out);
}

// ---------------------------------------------------------------- one garment's solve
// rec: { id, L, meshes: [m], G (particles), kit, F, fabric }; under: [records solved earlier, sharing a zone]; rigid: [{ surf, h }]
function solveOne(h, ctx, rec, under, rigid, o) {
  const t0 = now(), { L, G, kit } = rec, F = rec.F, np = G.np, S = ctx.S, part = L.d.part, fabric = rec.fabric, tuck = (L.rules.tuck ?? 'in') === 'in';
  const gapBody = GAP_SKIN + F.h / 2, gap = GAP_SKIN + 0.0015 + F.h / 2;
  // a tucked top: the band from under the waistband's top down to the tail is held snug (it goes INTO the waistband ring: its cut edge,
  // which the shader draws 1.5 cm under the trousers' top, is then under them, not a free hem hanging over them: c1's shards); less blousing
  const tuckTop = rec.tuckTop ?? (kit.yW + 0.05);
  if (part === 'top' && tuck && rec.underBottoms) kit.fit = { ...kit.fit, len: 0 };   // the tuck takes the length the c1 cut added for blousing
  if (part === 'top' && L.rules.sleeves?.roll) kit.fit = { ...kit.fit, slv: 0 };
  // what is drawn: visible particles (any of their mesh vertices kept by the cut), plus two rings
  const vis = new Uint8Array(np); for (const { m, pid } of G.meshes) { const vv = visibleVerts(m); for (let v = 0; v < pid.length; v++) if (vv[v]) vis[pid[v]] = 1; }
  const visCore = Uint8Array.from(vis);   // what the shader draws
  if (part === 'top' && tuck) for (let p = 0; p < np; p++) if (isTrunk(G.AH[p * 4]) && G.Xb[p * 3 + 1] > kit.yW - 0.07) vis[p] = 1;   // a tucked tail: under the waistband
  for (let ring = 0; ring < 2; ring++) { const add = []; for (let p = 0; p < np; p++) if (vis[p]) for (const u of G.nb[p]) if (!vis[u]) add.push(u); for (const u of add) vis[u] = 1; }
  // the pattern (bind), then held outside every layer under it (its soft gap)
  const ease = part === 'top' ? (p, r, lc, x, y) => (isArm(r) ? kit.easeArm(lc) : kit.easeTrunkTop(y)) : part === 'bottom' ? (p, r, l, x, y) => (isLeg(r) ? kit.easeLeg(l) : kit.kLeg * kit.lcut.seat * sstep(kit.yW - 0.02, kit.yHip, y)) : (p, r, lc, x, y) => (y > kit.yS - 0.02 ? 0 : 0.06 * sstep(kit.yS - 0.02, kit.yC, y));
  const outsideUnder = P => { for (const U of under) { if (!U.bindSurf) continue; const need = LY.layerGap(U.fabric, fabric).soft; for (let p = 0; p < np; p++) { const q = U.bindSurf.closest(P[p * 3], P[p * 3 + 1], P[p * 3 + 2], 0.06); if (!q || q.edge || q.d >= need) continue; const k = need - q.d; P[p * 3] += q.nx * k; P[p * 3 + 1] += q.ny * k; P[p * 3 + 2] += q.nz * k; } } };
  let pat;
  // a hero top that carries the c7 collar keeps its shell at the yoke (c1's rule): the collar was made on the shell, and with the yoke
  // resting on the body the collar followed it 1 cm in, under the shirt (no collar in the first c2 stills)
  const shellYoke = rec.collar ? (p, r, lc, y) => (isTrunk(r) ? sstep(kit.yS - 0.12, kit.yS - 0.03, y) : isArm(r) ? sstep(0.14, 0.03, lc) * sstep(kit.yS - 0.14, kit.yS - 0.04, y) : 0) : null;
  if (part === 'top') pat = D.pattern(ctx, G, { keep: ctx.bodyBind, soft: ctx.bodySoft, hard: 0.003 + F.h / 2, gap, ease, straight: [D.trunkStraight(G, kit.yC, kit.fit.straight, -Infinity), ...kit.armStraight(G)], lengthen: kit.lengthenTop, shell: shellYoke, after: outsideUnder });
  else if (part === 'bottom') pat = D.pattern(ctx, G, { keep: ctx.bodyBind, soft: ctx.bodySoft, hard: 0.003 + F.h / 2, gap, ease, straight: kit.legStraight(G), lengthen: kit.lengthenLeg, after: outsideUnder });
  else if (part === 'vest') pat = D.pattern(ctx, G, { keep: ctx.bodyBind, gap, wrap: 20, ease, straight: [D.trunkStraight(G, kit.yC, 1, -Infinity)], after: outsideUnder });
  else pat = { P: Float64Array.from(G.Xb), E: new Float64Array(np) };
  const P = pat.P, X0 = D.poseP(ctx, P, G.SI, G.SW), XR = D.poseP(ctx, G.Xb, G.SI, G.SW);
  // the outermost thing under a posed point (for holds that rest on it): the last under-layer that covers it, else the body
  const restOn = (x, y, z, extra) => { for (let k = under.length - 1; k >= 0; k--) { const U = under[k]; if (!U.surf) continue; const q = U.surf.closest(x, y, z, 0.05); if (q && !q.edge && q.d > -0.01) { const t = LY.layerGap(U.fabric, fabric).hard + extra; return [q.px + q.nx * t, q.py + q.ny * t, q.pz + q.nz * t]; } }
    const q = ctx.bodyPosed.closest(x, y, z, 0.1); if (!q) return [x, y, z]; const t = gapBody + extra; return [q.px + q.nx * t, q.py + q.ny * t, q.pz + q.nz * t]; };
  // holds
  const pin = new Uint8Array(np), soft = [], tail = new Uint8Array(np);
  for (let p = 0; p < np; p++) { if (!vis[p]) continue; const r = G.AH[p * 4], y = G.Xb[p * 3 + 1], lc = G.AH[p * 4 + 1];
    if (part === 'top') { if (kit.yokePin(G, p)) { pin[p] = 1; continue; }
      if (tuck && isTrunk(r) && y < tuckTop + 0.012) { tail[p] = 1; soft.push({ i: p, x: restOn(XR[p * 3], XR[p * 3 + 1], XR[p * 3 + 2], under.length ? 0.0005 : TAIL_GAP - GAP_SKIN), alpha: 2e-6 }); }   // the tail, snug on what is under it (the waistband goes over it)
      else if (isArm(r) && (!kit.fit.slv || L.rules.sleeves?.roll) && kit.armEnd < 2 && lc > kit.armEnd - 0.08) soft.push({ i: p, x: under.length ? restOn(XR[p * 3], XR[p * 3 + 1], XR[p * 3 + 2], 0.004) : [XR[p * 3], XR[p * 3 + 1], XR[p * 3 + 2]], alpha: 2e-6 }); }   // a rolled sleeve, held by the roll (on the sleeve under it, if any)
    else if (part === 'bottom') { if (isLeg(r) || y <= kit.yW - 0.035) continue; pin[p] = 1; }
    else if (part === 'vest') { if (y > kit.yS - 0.05) pin[p] = 1; }
    else if (part === 'skirt') { if (y > rec.yTop - 0.012) pin[p] = 1; } }
  // pinned particles rest on what is under them (a yoke on the undershirt's yoke, a waistband over the tucked tails)
  for (let p = 0; p < np; p++) if (pin[p]) { const t = restOn(X0[p * 3], X0[p * 3 + 1], X0[p * 3 + 2], 0); const q = (() => { for (let k = under.length - 1; k >= 0; k--) { const U = under[k]; if (!U.surf) continue; const r = U.surf.closest(X0[p * 3], X0[p * 3 + 1], X0[p * 3 + 2], 0.05); if (r && !r.edge) return { r, g: LY.layerGap(U.fabric, fabric).hard }; } return null; })();
    if (q && q.r.d < q.g) { const k = q.g - q.r.d; X0[p * 3] += q.r.nx * k; X0[p * 3 + 1] += q.r.ny * k; X0[p * 3 + 2] += q.r.nz * k; }
    else if (!q) { const b = ctx.bodyPosed.closest(X0[p * 3], X0[p * 3 + 1], X0[p * 3 + 2], 0.08); if (b && b.d < gapBody) { const k = gapBody - b.d; X0[p * 3] += b.nx * k; X0[p * 3 + 1] += b.ny * k; X0[p * 3 + 2] += b.nz * k; } } void t; }
  // a skirt's top ring rides on the coat body (as c1)
  // the simulated cloth: triangles with every corner in the drawn region; the rest rides afterwards
  const frozen = new Uint8Array(np); let nf = 0; for (let p = 0; p < np; p++) if (!vis[p]) { frozen[p] = 1; pin[p] = 1; nf++; for (let c = 0; c < 3; c++) X0[p * 3 + c] = XR[p * 3 + c]; }
  if (rec.dead) for (let p = 0; p < np; p++) if (!frozen[p] && rec.dead(p, G)) { frozen[p] = 1; pin[p] = 1; nf++; }
  for (let i = soft.length - 1; i >= 0; i--) if (frozen[soft[i].i]) soft.splice(i, 1);
  const trisC = G.tris.filter((_, i, T) => { const t = i - (i % 3); return !(frozen[T[t]] || frozen[T[t + 1]] || frozen[T[t + 2]]); });
  const warp = new Float64Array(np * 3); for (let p = 0; p < np; p++) { const r = G.AH[p * 4], sd = G.AH[p * 4 + 2] > 0 ? 'L' : 'R'; let d = [0, -1, 0]; if (isArm(r)) d = kit.arm[sd].d; else if (isLeg(r)) d = kit.leg[sd].d; warp.set(d, p * 3); }
  // a hi-vis vest is a light mesh knit held in shape by its bindings and tapes (c7 rims, the reflective stripes): it keeps half its cut
  // shape and bends 6x stiffer than the bare knit, or its lower band crumpled on the belt (dev stills, 3 Oct)
  const restAngle = fabric === 'leather' ? 0.4 : part === 'vest' ? 0.5 : 0, bendScale = part === 'vest' ? 6 : 1;
  const cl = new Cloth(P, trisC, F, { X0, pin, warp, restAngle, bendScale, compress: 0.25, gravity: ctx.grav, damping: 6, vmax: 1.0, self: part === 'vest' || part === 'skirt' ? 0 : 0.006, selfSkip: 4, stretchIters: o.iters, slack: 0.015 });
  cl.warpIn = warp; if (soft.length) cl.attach(soft);
  // the grown collider: body, rigid accessories, every layer under it (compressed gap + soft loft band)
  const gB = Float64Array.from(tail, t => (t ? TAIL_GAP + F.h / 2 : gapBody)), Ap = LY.particleAreas(X0, trisC, np), surf = [{ mesh: ctx.bodyPosed, gap: gB, mu: F.mu, reach: 0.05 }];
  for (const R of rigid) surf.push({ mesh: R.surf, gap: R.h / 2 + F.h / 2 + 0.0015, mu: F.mu, reach: 0.05 });
  for (const U of under) if (U.surf) { const c = LY.layerContact({ surf: U.surf, fabric: U.fabric }, fabric, Ap, { mu: F.mu }); if (U.belt) { c.gap = F.h / 2 + 0.001; c.soft.gap = c.gap + 0.001; c.garment = false; } surf.push(c); }   // a belt: its smooth bulge (makeBelt), rigid
  const ct = new Contacts(np, surf, { safe: true });
  cl.run(o.T, { hz: o.hz, contacts: ct, every: 6, selfEvery: 30 });
  return finishOne(h, ctx, rec, { cl, frozen, X0, XR, P, E: pat.E, pin, soft, trisC, warp, restAngle, t0, ct, nf, gapBody, visCore, tail });
}
// after a solve (or a joint settle, or a bake): the riding strip, the layer surfaces for what goes over it, the measures
function finishOne(h, ctx, rec, s) {
  const { G } = rec, np = G.np, X = s.cl.X, frozen = s.frozen;
  if (s.nf) { const done = new Uint8Array(np), dsp = new Float64Array(np * 3); let front = [];
    for (let p = 0; p < np; p++) if (!frozen[p]) { done[p] = 1; for (let c = 0; c < 3; c++) dsp[p * 3 + c] = X[p * 3 + c] - s.X0[p * 3 + c]; }
    for (let p = 0; p < np; p++) if (frozen[p] && G.nb[p].some(u => done[u])) front.push(p);
    for (let ring = 0; ring < 60 && front.length; ring++) { const next = new Set();
      for (const p of front) { let n = 0, dx = 0, dy = 0, dz = 0; for (const u of G.nb[p]) if (done[u]) { dx += dsp[u * 3]; dy += dsp[u * 3 + 1]; dz += dsp[u * 3 + 2]; n++; } if (!n) continue; dsp[p * 3] = dx / n; dsp[p * 3 + 1] = dy / n; dsp[p * 3 + 2] = dz / n; }
      for (const p of front) { done[p] = 2; for (const u of G.nb[p]) if (!done[u]) next.add(u); } front = [...next]; }
    for (let p = 0; p < np; p++) if (frozen[p] && done[p]) for (let c = 0; c < 3; c++) X[p * 3 + c] = s.X0[p * 3 + c] + dsp[p * 3 + c]; }
  const Nn = D.orientOut(X, s.trisC.length ? s.trisC : G.tris, ctx.bodyPosed);
  const surf = compactSurf(X, s.trisC, Nn);
  const tmp = [0, 0, 0], S = ctx.S, Xbind = new Float64Array(np * 3); for (let p = 0; p < np; p++) { blendInverse(G.SI, G.SW, p, ctx.M, X[p * 3] / S, X[p * 3 + 1] / S, X[p * 3 + 2] / S, tmp, 0); for (let c = 0; c < 3; c++) Xbind[p * 3 + c] = tmp[c] * S; }
  const Nb = vertexNormals(Xbind, s.trisC); if (Nn.sign < 0) for (let i = 0; i < Nb.length; i++) Nb[i] = -Nb[i];
  const bindSurf = compactSurf(Xbind, s.trisC, Nb);
  const vc = s.visCore || null, visTris = vc ? s.trisC.filter((_, i, T) => { const t = i - (i % 3); return vc[T[t]] && vc[T[t + 1]] && vc[T[t + 2]]; }) : s.trisC;
  const visSurf = visTris.length ? compactSurf(X, visTris, Nn) : null;   // the drawn cloth only: what 'covers' an inner layer
  Object.assign(rec, { solved: s, cl: s.cl, X, surf, bindSurf, Xbind, Nn, h: rec.F.h, visTris, visSurf });
  const mb = s.ct ? s.ct.measure(X, 0, 0.03, frozen) : { min: 0, mean: 0, inside: 0 }, st = s.cl.strain(true);
  rec.rep = { id: rec.id, design: rec.L.design, fabric: rec.fabric, particles: np, simulated: np - s.nf, tris: s.trisC.length / 3, ms: Math.round(now() - s.t0), penMax: Math.max(0, -mb.min) * 1000, inside: mb.inside,
    gapMean: mb.mean * 1000, stretchMean: st.mean, stretchP99: st.p99, pins: s.pin.reduce((a, b) => a + b, 0) - s.nf, soft: s.soft.length, under: rec.underIds || [] };
  return rec;
}
// a SurfaceMesh of only the particles the triangles use (frozen particles in the hash stalled the closest-point walk)
function compactSurf(X, tris, N) { const n = X.length / 3, map = new Int32Array(n).fill(-1); let k = 0; for (let i = 0; i < tris.length; i++) if (map[tris[i]] < 0) map[tris[i]] = k++;
  const Xc = new Float64Array(k * 3), Nc = new Float64Array(k * 3), Tc = new Int32Array(tris.length); for (let i = 0; i < n; i++) if (map[i] >= 0) { for (let c = 0; c < 3; c++) { Xc[map[i] * 3 + c] = X[i * 3 + c]; Nc[map[i] * 3 + c] = N[i * 3 + c]; } }
  for (let i = 0; i < tris.length; i++) Tc[i] = map[tris[i]]; return new SurfaceMesh(Xc, Tc, { cell: 0.03, boundary: true, normals: Nc }); }
// write a garment's posed particles back to its meshes (bind space through the inverse blend), the c1 contract, and its riding parts
function writeBack(h, ctx, rec, shared) {
  const { G } = rec, X = rec.X, S = ctx.S, tmp = [0, 0, 0], F = rec.F, fp = D.foldSignal(X, G.tris, G.nb, phys(rec.fabric).c, rec.Nn), outs = [];
  for (const { m, pid } of G.meshes) { const g = m.geometry, n = g.attributes.position.count, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, out = new Float32Array(n * 3), fold = new Float32Array(n);
    for (let v = 0; v < n; v++) { const p = pid[v]; blendInverse(SI, SW, v, ctx.M, X[p * 3] / S, X[p * 3 + 1] / S, X[p * 3 + 2] / S, tmp, 0); out[v * 3] = tmp[0]; out[v * 3 + 1] = tmp[1]; out[v * 3 + 2] = tmp[2]; fold[v] = fp[p]; }
    D.commit(m, out, fold, shared);
    // the riding parts (collar, rims, pockets) follow only the SOLVED cloth: the frozen strip past a cut rides loosely and threw collar
    // pieces onto the face; their pinned rests are kept for the rims' exact match
    const R = g.userData.drapeRest.position, live = []; for (let v = 0; v < n; v++) if (!rec.solved.frozen[pid[v]]) live.push(v);
    const liveRest = Float32Array.from(live.flatMap(v => [R[v * 3], R[v * 3 + 1], R[v * 3 + 2]])), liveNow = Float32Array.from(live.flatMap(v => [out[v * 3], out[v * 3 + 1], out[v * 3 + 2]]));
    outs.push({ m, rest: R, now: out, liveRest, liveNow }); }
  void F; return outs;
}
function ride(h, parts, parents, shared) { const done = [];
  for (const pr of parts) { const par = parents.find(p => p.k === pr.parent); if (!par) continue; const m = pr.m, R = D.keepRest(m).position, pos = par.liveRest?.length ? D.follow(R, par.liveRest, par.liveNow) : D.follow(R, par.rest, par.now);
    if (pr.name.startsWith('rim')) { const g = m.geometry, pg = par.m.geometry, key = (G2, v) => { const I = G2.attributes.skinIndex.array, W = G2.attributes.skinWeight.array, A = G2.attributes.aHero.array;
        return `${I[v * 4]},${I[v * 4 + 1]},${I[v * 4 + 2]},${I[v * 4 + 3]},${W[v * 4].toFixed(5)},${W[v * 4 + 1].toFixed(5)},${A[v * 4].toFixed(4)},${A[v * 4 + 1].toFixed(5)},${A[v * 4 + 2]}`; };
      const mp = new Map(); for (let v = 0; v < pg.attributes.position.count; v++) mp.set(key(pg, v), v);
      for (let v = 0; v < g.attributes.position.count; v++) { const u = mp.get(key(g, v)); if (u == null) continue; for (let c = 0; c < 3; c++) pos[v * 3 + c] = R[v * 3 + c] + par.now[u * 3 + c] - par.rest[u * 3 + c]; } }
    D.commit(m, pos, null, shared); done.push(`${pr.name} on ${pr.parent}`); }
  return done; }

// a boot as a collider for what goes over it: its OUTER wall only. The c7 boot's shaft is open at the top with an inner wall; a trouser
// leg narrower than the opening slid down between the leg and the shaft (the jeans read as tucked into the boots). Without the inner
// wall, cloth in that gap finds the outer wall as its nearest surface, from inside, and is pushed out over the shaft.
function bootShell(S) {
  const X = S.X, T = S.tris, keep = []; let yMax = -Infinity; for (let v = 0; v < S.n; v++) yMax = Math.max(yMax, X[v * 3 + 1]);
  const cen = side => { let x = 0, z = 0, k = 0; for (let v = 0; v < S.n; v++) if (Math.sign(X[v * 3]) === side && X[v * 3 + 1] > yMax * 0.55) { x += X[v * 3]; z += X[v * 3 + 2]; k++; } return [x / Math.max(1, k), z / Math.max(1, k)]; }, C = { 1: cen(1), '-1': cen(-1) };
  for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2], cx = (X[a * 3] + X[b * 3] + X[c * 3]) / 3, cy = (X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1]) / 3, cz = (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3;
    if (cy > yMax * 0.45) { const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
      const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx, k = C[Math.sign(cx) || 1]; if (nx * (cx - k[0]) + nz * (cz - k[1]) < 0) continue; }   // faces the leg: the inner wall
    keep.push(a, b, c); }
  const out = new SurfaceMesh(S.X, Int32Array.from(keep), { cell: 0.03 }); out.dropped = (T.length - keep.length) / 3; return out;
}

// ---------------------------------------------------------------- the belt: a ring over the trousers' waistband
// built round the solved trousers (posed): per 10-degree sector of the waist, the band's outer radius less the cinch, 3.8 cm tall, its
// top 1 cm under the trousers' top edge; a rigid part (skinned like the waistband under it) that holds the waistband in (a ceiling for
// the trousers in the joint settle) and is a collider for what goes over it. Leather, a buckle at the front.
function makeBelt(h, ctx, L, trousers) {
  const G = trousers.G, X = trousers.X, kit = trousers.kit, cinch = L.rules.cinch ?? 0.02, W = 0.038, T = 0.0045, NS = 48;
  const vc = trousers.solved.visCore; let yTop = -Infinity; for (let p = 0; p < G.np; p++) if ((vc ? vc[p] : !trousers.solved.frozen[p]) && !isLeg(G.AH[p * 4])) yTop = Math.max(yTop, G.Xb[p * 3 + 1]);   // the DRAWN top
  // its top at the waistband's top: it covers the line where the tucked shirt goes in
  const yHi = (yTop + 0.002), yLo = yHi - W, band = []; for (let p = 0; p < G.np; p++) { const y = G.Xb[p * 3 + 1]; if (y <= yHi + 0.004 && y >= yLo - 0.004 && !isLeg(G.AH[p * 4])) band.push(p); }
  let cx = 0, cz = 0; for (const p of band) { cx += X[p * 3]; cz += X[p * 3 + 2]; } cx /= band.length; cz /= band.length;
  const R = new Float64Array(NS), Y0 = new Float64Array(NS).fill(0), Y1 = new Float64Array(NS).fill(0), cnt = new Float64Array(NS);
  for (const p of band) { const a = Math.atan2(X[p * 3 + 2] - cz, X[p * 3] - cx), s = ((Math.floor((a / TAU + 1) * NS) % NS) + NS) % NS, r = Math.hypot(X[p * 3] - cx, X[p * 3 + 2] - cz); R[s] = Math.max(R[s], r); Y0[s] += X[p * 3 + 1]; cnt[s]++; }
  for (let s = 0; s < NS; s++) { if (!cnt[s]) { let k = 1; while (!cnt[(s + k) % NS] && k < NS) k++; R[s] = R[(s + k) % NS]; Y0[s] = Y0[(s + k) % NS] / Math.max(1, cnt[(s + k) % NS]); } else Y0[s] /= cnt[s]; }
  // a belt is a smooth band: the sector radii and heights low-passed round the waist (6 passes of a [1 2 1] blur, then never inside 97 %
  // of the raw outline: a crumpled waistband must not make a crumpled belt); the cinch then takes up its girth
  const blur = (A, n) => { let B = Float64Array.from(A); for (let it = 0; it < n; it++) B = B.map((_, s) => (B[(s + NS - 1) % NS] + 2 * B[s] + B[(s + 1) % NS]) / 4); return B; };
  const Rb = blur(R, 6), Rs = Rb.map((r, s2) => Math.max(r, R[s2] * 0.97)), Rss = blur(Rs, 2), Ys = blur(Y0, 8); Y0.set(Ys); Rs.set(Rss);
  const girth0 = Rs.reduce((a, r) => a + r, 0) * TAU / NS, k = 1 - cinch;
  // posed rings: inner bottom, inner top, outer top, outer bottom (a closed box section) per sector; the band's centre height follows the waistband's tilt
  const P = [], Tr = [], ring = (s) => { const a = (s + 0.5) / NS * TAU; return [Math.cos(a), Math.sin(a)]; };
  for (let s = 0; s < NS; s++) { const [c, sn] = ring(s), yc = Y0[s], ri = Rs[s] * k + 0.001, ro = ri + T;
    P.push(cx + c * ri, yc - W / 2, cz + sn * ri, cx + c * ri, yc + W / 2, cz + sn * ri, cx + c * ro, yc + W / 2, cz + sn * ro, cx + c * ro, yc - W / 2, cz + sn * ro); }
  for (let s = 0; s < NS; s++) { const a = s * 4, b = ((s + 1) % NS) * 4; for (let q = 0; q < 4; q++) { const i0 = a + q, i1 = a + (q + 1) % 4, j0 = b + q, j1 = b + (q + 1) % 4; Tr.push(i0, j0, i1, i1, j0, j1); } }
  // the buckle: a frame at the front (the sector nearest +z), 5.2 x 4.6 cm, standing 4 mm proud
  { let sb = 0, best = -Infinity; for (let s = 0; s < NS; s++) { const [c, sn] = ring(s); if (sn > best) { best = sn; sb = s; } } const [c, sn] = ring(sb), r = Rs[sb] * k + 0.001 + T + 0.004, y = Y0[sb], tx = -sn, tz = c, o = P.length / 3;
    for (const [u, v] of [[-0.026, -0.023], [0.026, -0.023], [0.026, 0.023], [-0.026, 0.023]]) for (const dr of [-0.004, 0]) P.push(cx + c * (r + dr) + tx * u, y + v, cz + sn * (r + dr) + tz * u);
    const f = (a, b, c2, d) => Tr.push(o + a, o + b, o + c2, o + a, o + c2, o + d); f(1, 3, 5, 7); f(0, 2, 3, 1); f(2, 4, 5, 3); f(4, 6, 7, 5); f(6, 0, 1, 7); }
  const Xp = Float64Array.from(P), Ti = Int32Array.from(Tr), surf = rigidSurface(Xp, Ti, { cell: 0.03 });
  // the ceiling for the waistband under it is the same oriented box: the inner face's outward normal points to the waist's centre
  const ceilMesh = surf;
  // bind positions and skinning from the nearest waistband particle (the belt moves with the pelvis as the waistband does)
  const n = Xp.length / 3, bind = new Float32Array(n * 3), SI = new Uint16Array(n * 4), SWt = new Float32Array(n * 4), tmp = [0, 0, 0];
  for (let v = 0; v < n; v++) { let best = band[0], bd = Infinity; for (const p of band) { const d = (X[p * 3] - Xp[v * 3]) ** 2 + (X[p * 3 + 1] - Xp[v * 3 + 1]) ** 2 + (X[p * 3 + 2] - Xp[v * 3 + 2]) ** 2; if (d < bd) { bd = d; best = p; } }
    for (let c = 0; c < 4; c++) { SI[v * 4 + c] = G.SI[best * 4 + c]; SWt[v * 4 + c] = G.SW[best * 4 + c]; } blendInverse(SI, SWt, v, ctx.M, Xp[v * 3] / ctx.S, Xp[v * 3 + 1] / ctx.S, Xp[v * 3 + 2] / ctx.S, tmp, 0); bind.set(tmp, v * 3); }
  // what goes over the belt drapes on a smooth bulge, not on the box: the box's square edges came through a light vest between its
  // particles (a brown sawtooth along the vest's hem); per sector, rings 3 cm under and over the belt ramp from the waistband out to it
  const BP = [], BT = [], NR = 4; for (let s2 = 0; s2 < NS; s2++) { const [c, sn] = ring(s2), yc = Y0[s2], r0 = Rs[s2] * k + 0.001, r1 = r0 + T + 0.004;
    for (const [dy, r] of [[-W / 2 - 0.03, r0], [-W / 2, r1], [W / 2, r1], [W / 2 + 0.03, r0]]) BP.push(cx + c * r, yc + dy, cz + sn * r); }
  for (let s2 = 0; s2 < NS; s2++) { const a = s2 * NR, b = ((s2 + 1) % NS) * NR; for (let q = 0; q < NR - 1; q++) BT.push(a + q, b + q, a + q + 1, a + q + 1, b + q, b + q + 1); }
  const bulge = rigidSurface(Float64Array.from(BP), Int32Array.from(BT), { cell: 0.03 });
  return { surf, ceilMesh, bulge, posed: Xp, tris: surf.tris, bind,   // the render uses the outward-wound copy (FrontSide)
    SI, SW: SWt, girth0, girth: girth0 * k, yLo, yHi, band, cx, cz, h: T };
}
function beltMesh(h, B, L) {
  const THREE_BA = h.body.geometry.attributes.position.constructor, g = new h.body.geometry.constructor(), n = B.bind.length / 3, AH = new Float32Array(n * 4); for (let v = 0; v < n; v++) AH[v * 4] = RG.pelvis;
  g.setAttribute('position', new THREE_BA(B.bind, 3)); g.setAttribute('skinIndex', new h.body.geometry.attributes.skinIndex.constructor(B.SI, 4)); g.setAttribute('skinWeight', new THREE_BA(B.SW, 4));
  g.setAttribute('aHero', new THREE_BA(AH, 4)); g.setAttribute('uv', new THREE_BA(new Float32Array(n * 2), 2)); g.setIndex(Array.from(B.tris)); g.computeVertexNormals();
  const m = h._addCloth(g, { kind: 4, a: L.color || '#2a1c14', b: L.color || '#2a1c14', dirt: (h.o.dirt || 0) * 0.5, part: 7, key: 'belt', fab: L.fabric || 'leather' });
  m.material.side = 0; m.userData.stack = L.id; m.userData.proc = true; return m;
}

// ---------------------------------------------------------------- bakes (memory per hero; disk when written by stack_bake.mjs)
export const STACK_BAKE_DIR = new URL('../../../assets/cloth/stack/', import.meta.url);
export function packStack(key, arrays) { const head = { v: 1, key, arrays: [] }, chunks = []; for (const [id, a] of Object.entries(arrays)) { const f = Float32Array.from(a); head.arrays.push({ id, n: f.length }); chunks.push(new Uint8Array(f.buffer)); }
  const hj = new TextEncoder().encode(JSON.stringify(head)), pad = (4 - (hj.length % 4)) % 4, out = new Uint8Array(4 + hj.length + pad + chunks.reduce((a, c) => a + c.length, 0)); new DataView(out.buffer).setUint32(0, hj.length + pad, true); out.set(hj, 4); out.fill(32, 4 + hj.length, 4 + hj.length + pad);
  let o = 4 + hj.length + pad; for (const c of chunks) { out.set(c, o); o += c.length; } return out; }
function unpackStack(buf) { const u8 = new Uint8Array(buf), hl = new DataView(u8.buffer, u8.byteOffset).getUint32(0, true), head = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hl))); let o = 4 + hl; const out = {};
  for (const a of head.arrays) { out[a.id] = new Float32Array(u8.slice(o, o + a.n * 4).buffer); o += a.n * 4; } return { key: head.key, arrays: out }; }
async function loadStackBake(key) { try { if (typeof fetch !== 'function') return null; const r = await fetch(new URL(`${key}.bin`, STACK_BAKE_DIR)); if (!r || r.ok === false) return null; const b = unpackStack(await r.arrayBuffer()); return b.key === key ? b.arrays : null; } catch (e) { return null; } }

// ---------------------------------------------------------------- the person dressed
// opts: { cache (true), disk (true: look for assets/cloth/stack bakes), collect (bake bytes in S.bakes), T (s per garment, 0.8), hz (900), iters (2),
//         joint (s of joint settle, 0.15; 0 = off), guard ('measure': inner-through-outer counts; 'move': also push stray inner particles
//         in, up to 15 mm: it made edge crossings WORSE on Rosa (82 -> 157), so it is off by default; false: no measure) }
export async function dressPerson(h, outfit, opts = {}) {
  const o = { cache: true, disk: true, collect: false, T: 0.8, hz: 900, iters: 2, joint: 0.15, guard: 'measure', ...opts }, t0 = now();
  const C = compileOutfit(outfit), shared = new Set();
  // K3: with foundations worn (foundations.js wearFoundations), everything drapes on the body AS THEY DRESS IT (the bust in the bra, the
  // briefs over the fork, the undershirt): the collider is built from h._foundBody (bind positions over the base layer), opt-in
  const foundOn = C.order.some(x => C.layers.get(x).d.source === 'found') && h._foundBody; let ctx = D.context(h, foundOn ? { positions: h._foundBody } : {});
  const st = h._stackState || (h._stackState = { mem: new Map(), meshes: new Map(), belts: new Map() });
  if (!h._fabDepth) { try { const [{ fabricDepth }, { HERO_CLOTH_GLSL }] = await Promise.all([import('./fabric_glsl.js'), import('../hero.js')]); h._fabDepth = mat => fabricDepth(mat, HERO_CLOTH_GLSL); } catch (e) { h._fabDepth = null; } }
  // the pose key: every bone's local transform, gravity, scale (as drape.js bakeKey) + the hero variant
  const r4 = x => (Math.round(x * 1e4) / 1e4 + 0).toFixed(4), poseParts = [h.o?.variant || 'hero']; for (const b of h.bones) poseParts.push([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, b.position.x, b.position.y, b.position.z].map(r4).join(','));
  poseParts.push(ctx.grav.map(x => x.toFixed(2)).join(','), r4(ctx.S)); const base = poseParts.join('|') + (o.carry ? '|carry:' + JSON.stringify(o.carry) : ''), keys = stackKeys(C, base, VERSIONS), stackKey = `${h.o?.variant || 'hero'}-stack-${keys.size ? [...keys.values()].map(k => k.slice(-16)).join('').slice(0, 64) : 'nude'}`;
  // CLOTH3 (round 3, opt-in o.carry: true | { steps, T, settle }): sew and settle in the A-pose (bind), where K2's panels were placed and
  // sewed clean, then CARRY the cloth to the pose the hero stands in (carryRun, after the garments below). The pose is remembered here
  // and the hero goes to bind; the pose key above is the target pose's (plus the carry), so bakes stay keyed by what is drawn.
  let carryTo = null;
  if (o.carry) { carryTo = { q: h.bones.map(b => b.quaternion.clone()), p: h.bones.map(b => b.position.clone()), flex: h._flex }; h.resetPose(); h.update(); ctx = D.context(h, foundOn ? { positions: h._foundBody } : {}); }
  // every garment mesh back to its undraped rest; what the outfit does not list is hidden (nude-up: only what is worn shows)
  const C1 = h.cloth || {}, worn = new Set(), meshOf = new Map();
  for (const x of C.order) { const L = C.layers.get(x); let ms = [];
    if (L.d.source === 'hero') { const m = heroMesh(h, L); if (m) ms = [m]; }
    else if (L.d.source === 'shell') { let m = st.meshes.get(x); if (!m) { m = makeShell(h, L); st.meshes.set(x, m); } ms = [m]; }
    meshOf.set(x, ms); for (const m of ms) worn.add(m); }
  for (const [k, v] of Object.entries(C1)) for (const m of list(v)) { if (k === 'boots' || k === 'gloves' || k === 'rims' || k === 'collar' || k === 'pockets') continue; m.visible = worn.has(m); }
  for (const [, m] of st.meshes) m.visible = worn.has(m);
  for (const [, m] of st.belts) { m.visible = false; }
  const parts = parentsOfParts(h), wornKeys = new Set(C.order.map(x => C.layers.get(x)).filter(L => L.d.source === 'hero').map(L => L.d.key));
  for (const pr of parts) pr.m.visible = wornKeys.has(pr.parent);
  if (C1.boots) for (const m of list(C1.boots)) m.visible = C.order.some(x => C.layers.get(x).d.key === 'boots');
  for (const m of [...worn, ...parts.map(p => p.m)]) { D.keepRest(m); D.restore(m); }
  // painted belt on the trousers only when no real belt is worn
  const bottomL = C.order.map(x => C.layers.get(x)).find(L => L.d.part === 'bottom'), hasBelt = C.order.some(x => C.layers.get(x).d.source === 'belt');
  if (bottomL) { const m = meshOf.get(bottomL.id)?.[0]; if (m?.material?.uniforms_c6?.cHem2) { const v = m.material.uniforms_c6.cHem2.value; if (m.userData._belt0 == null) m.userData._belt0 = v.z; v.z = hasBelt ? 0 : m.userData._belt0; } }
  // the rigid colliders
  const buildRigid = cx => { const rigid = []; for (const x of C.rigid) { const L = C.layers.get(x); const ms = list(C1[L.d.key]); if (!ms.length) continue; const Ps = [], Ts = []; let off = 0;
    for (const m of ms) { const g = m.geometry, n = g.attributes.position.count, X = skinPose(g.attributes.position.array, g.attributes.skinIndex.array, g.attributes.skinWeight.array, cx.M, new Float64Array(n * 3), cx.S); for (let i = 0; i < X.length; i++) Ps.push(X[i]); const ix = g.index.array; for (let i = 0; i < ix.length; i++) Ts.push(ix[i] + off); off += n; }
    let surf = rigidSurface(Float64Array.from(Ps), Int32Array.from(Ts), { cell: 0.03 }); if (L.d.key === 'boots') surf = bootShell(surf); rigid.push({ id: x, surf, h: 0.002, fabric: 'bootLeather' }); } return rigid; };
  let rigid = buildRigid(ctx);
  // ---- garments, innermost first
  const recs = new Map(), reps = [], disk = o.cache && o.disk ? await loadStackBake(stackKey) : null, bakes = {}; let fromDisk = !!disk;
  for (const x of C.order) { const L = C.layers.get(x), src = L.d.source; if (src === 'rigid') continue;
    const underRecs = C.under.get(x).map(y => recs.get(y)).filter(Boolean);
    if (src === 'belt') { const tr = underRecs.filter(r => r.L.d.part === 'bottom').slice(-1)[0]; if (!tr) continue;
      const B = makeBelt(h, ctx, L, tr), m = st.belts.get(x) || beltMesh(h, B, L); if (!st.belts.has(x)) st.belts.set(x, m); else { m.geometry.attributes.position.array.set(B.bind); m.geometry.attributes.position.needsUpdate = true; m.geometry.computeVertexNormals(); } m.visible = true;
      const rec = { id: x, L, belt: B, surf: B.bulge, bindSurf: null, fabric: L.fabric || 'leather', F: phys(L.fabric || 'leather'), mesh: m };
      rec.rep = { id: x, design: 'belt', girth0Cm: B.girth0 * 100, girthCm: B.girth * 100, ms: 0 }; recs.set(x, rec); reps.push(rec.rep); continue; }
    if (src === 'found') { const e = h._found?.get(x); reps.push({ id: x, design: L.design, found: true, kind: e?.kind ?? null, ms: 0 }); continue; }   // K3: on the hero already; the collider is the body over it
    if (src === 'pattern') { if (bottomL && C.over.get(x).includes(bottomL.id) && (L.d.crowd?.part === 'top' || L.pattern?.crowd?.part === 'top' || !L.pattern?.crowd)) { const bm = meshOf.get(bottomL.id)?.[0];
        // a sewn bottom (K3): the tuck line is its waistband's posed height (the hold's placed vertices, posed by the body's weights)
        L.tuckTop = bottomL.d.source === 'pattern' ? patternWaistY(h, ctx, bottomL.pattern) : (bm?.material?.uniforms_c6?.cHem2 ? bm.material.uniforms_c6.cHem2.value.x : h.hems.waistY + 0.05) * ctx.S; }
      const rec = solvePattern(h, ctx, L, underRecs, rigid, o); rec.underIds = C.under.get(x); recs.set(x, rec); reps.push(rec.rep); continue; }
    const ms = meshOf.get(x); if (!ms?.length) continue; const m = ms[0], fabric = L.fabric || (src === 'hero' ? D.fabricFor(h, L.d.key) : L.d.fabric), F = phys(fabric);
    const G = D.particlesOf(h, ms, ctx.S, { byBody: L.d.part !== 'vest' && L.d.part !== 'skirt' });
    // wearing rules that move a shell's cuts (on its own uniforms; remembered so a later dress restores them): sleeves rolled n turns
    // (each ~4 cm up the arm, held at the roll), a neckline raised or lowered (m)
    if (L.d.part === 'top' && m.material.uniforms_c6?.cHem) { const U = m.material.uniforms_c6.cHem.value; if (m.userData._cHem0 == null) m.userData._cHem0 = [U.x, U.w];
      U.x = m.userData._cHem0[0] - 0.13 * (L.rules.sleeves?.roll || 0); U.w = m.userData._cHem0[1] + (L.rules.neck || 0); }
    const kind = src === 'shell' ? L.d.kind : (h.o?.kind || 'work'), botFab = bottomL ? (bottomL.fabric || D.fabricFor(h, 'bottom')) : null;
    const topsUnder = underRecs.filter(r => r.L.d.part === 'top' && r.kit), over = L.d.part === 'top' && topsUnder.length ? topsUnder.reduce((a, r) => ({ chest: a.chest + r.kit.fit.chest * r.kit.kTop, waist: a.waist + r.kit.fit.waist * r.kit.kTop, uarm: a.uarm + r.kit.fit.uarm * r.kit.kTop, farm: a.farm + r.kit.fit.farm * r.kit.kTop }), { chest: 0, waist: 0, uarm: 0, farm: 0 }) : null;
    const kit = cutKit(h, ctx, { kind, fabric, botFab: L.d.part === 'bottom' ? fabric : botFab, armEnd: m.material.uniforms_c6?.cHem ? m.material.uniforms_c6.cHem.value.x : null, over });
    const rec = { id: x, L, G, kit, F, fabric, meshes: ms, underIds: C.under.get(x), collar: src === 'hero' && L.d.key === 'top' && !!C1.collar };
    if (L.d.part === 'top' && bottomL && C.over.get(x).includes(bottomL.id)) { rec.underBottoms = true; const bm = meshOf.get(bottomL.id)?.[0]; rec.tuckTop = bm?.material?.uniforms_c6?.cHem2 ? bm.material.uniforms_c6.cHem2.value.x : kit.yW + 0.05; }
    // a coat's body below its skirt's join is not cloth of its own (the skirt is): it rides (c1)
    if (L.d.part === 'top' && C.order.some(y => C.layers.get(y).d.key === 'skirt') && src === 'hero') { const yT = (ctx.hem('skirtTop') || kit.yW) - 0.02; rec.dead = (p, G2) => !isArm(G2.AH[p * 4]) && G2.Xb[p * 3 + 1] < yT; }
    if (L.d.part === 'skirt') { const top = underRecs.filter(r => r.L.d.part === 'top' && r.L.d.source === 'hero').slice(-1)[0], yTop = ctx.hem('skirtTop') || kit.yW; rec.yTop = yTop;
      if (top) { const live = []; for (let p = 0; p < top.G.np; p++) if (!top.solved.frozen[p]) live.push(p);
        const dsp = D.follow(G.Xb, Float64Array.from(live.flatMap(p => [top.G.Xb[p * 3], top.G.Xb[p * 3 + 1], top.G.Xb[p * 3 + 2]])), Float64Array.from(live.flatMap(p => [top.Xbind[p * 3], top.Xbind[p * 3 + 1], top.Xbind[p * 3 + 2]])), 0.03);
        for (let p = 0; p < G.np; p++) { const w = sstep(yTop - 0.15, yTop - 0.02, G.Xb[p * 3 + 1]); for (let c = 0; c < 3; c++) G.Xb[p * 3 + c] += (dsp[p * 3 + c] - G.Xb[p * 3 + c]) * w; } } }
    const key = keys.get(x), cached = o.cache && (disk?.[x] ? { X: disk[x] } : st.mem.get(key));
    if (cached) { restoreOne(h, ctx, rec, underRecs, rigid, o, Float64Array.from(cached.X)); rec.rep.cached = disk ? 'disk' : 'memory'; }
    else solveOne(h, ctx, rec, underRecs, rigid, o);
    if (!disk) st.mem.set(key, { X: Float64Array.from(rec.X) }); if (o.collect) bakes[x] = rec.X;
    recs.set(x, rec); reps.push(rec.rep); }
  // CLOTH3: the carry from the A-pose to the hero's pose (the joint settle, guard, write-back and cull below then run in that pose)
  let carry = null, tuckP = [];
  if (carryTo) { const cr = carryRun(h, C, recs, carryTo, o, () => D.context(h, foundOn ? { positions: h._foundBody } : {}), buildRigid); ctx = cr.ctx; rigid = cr.rigid; carry = cr.report; tuckP = cr.pairs || []; }
  // ---- the joint settle (the two-way coupling) and the guard
  const draped = C.order.map(x => recs.get(x)).filter(r => r && r.cl);
  let joint = null;
  if (disk) { for (const r of draped) if (disk[r.id]) { r.X.set(disk[r.id]); r.cl.X.set(disk[r.id]); refreshRec(h, ctx, r, false); } joint = { fromBake: true }; }
  else if (o.joint > 0 && draped.length > 1) {
    const memJ = o.cache ? st.mem.get(stackKey) : null;
    if (memJ) { for (const r of draped) if (memJ[r.id]) { r.cl.X.set(memJ[r.id]); r.X = r.cl.X; refreshRec(h, ctx, r, false); } joint = { cached: true }; }
    else { const LYS = draped.map(r => ({ key: r.id, cl: r.cl, fabric: r.fabric, flip: r.Nn.sign < 0, vis: r.solved.visCore || null, solve: { soft: r.solved.soft, restAngle: r.solved.restAngle }, ...(r.c4fabs ? { triFabs: r.c4fabs } : {}) }));
      const beltRecs = C.order.map(x => recs.get(x)).filter(r => r && r.belt);
      const coll = [{ mesh: ctx.bodyPosed, gap: (li, i) => (draped[li].solved.tail?.[i] ? TAIL_GAP : GAP_SKIN) + draped[li].F.h / 2, mu: 0.45, reach: 0.05 }, ...rigid.map(R => ({ mesh: R.surf, gap: (li) => R.h / 2 + draped[li].F.h / 2 + 0.0015, reach: 0.05 })),
        ...beltRecs.flatMap(B => { const tr = draped.findIndex(r => r.L.d.part === 'bottom'); if (tr < 0) return []; const G = draped[tr].G, B2 = B.belt;
          return [{ mesh: B2.ceilMesh, gap: 0.0012, mu: 0.6, reach: 0.04, mask: (li, i) => li === tr && G.Xb[i * 3 + 1] <= B2.yHi + 0.002 && G.Xb[i * 3 + 1] >= B2.yLo - 0.002 && !isLeg(G.AH[i * 4]) },
            { mesh: B2.bulge, gap: (li) => draped[li].F.h / 2 + 0.001, reach: 0.05, mask: (li) => C.order.indexOf(draped[li].id) > C.order.indexOf(B.id) },
            // a tucked top goes in UNDER the belt: its cloth at the belt's height is held inside the belt's inner face (the waistband's
            // thickness further in); above the belt it is free (blousing over a belt hid the belt and read as a shirt worn out)
            { mesh: B2.ceilMesh, gap: (li) => 0.0012 + draped[li].F.h / 2 + 0.001, mu: 0.6, reach: 0.04, mask: (li, i) => (draped[li].underBottoms || draped[li].L.tuckTop != null) && draped[li].G.Xb[i * 3 + 1] <= B2.yHi + 0.004 && draped[li].G.Xb[i * 3 + 1] >= B2.yLo - 0.002 }]; })];
      // CARRY (hold3): the tucked band held inside the trousers' upper band in the joint settle too
      for (const pr of tuckP) { const cz = tuckCeiling(pr.bottom, ctx), li0 = draped.indexOf(pr.top); if (cz && li0 >= 0) coll.push({ mesh: cz.mesh, gap: LY.layerGap(pr.top.fabric, pr.bottom.fabric).hard, mu: 0.3, reach: 0.03, garment: true, mask: (li, i) => li === li0 && !!pr.mask[i] }); }
      joint = LY.jointSettle(LYS, o.jointColl === false ? [] : coll, { T: o.joint, hz: o.hz, gravity: ctx.grav, iters: o.iters, self: o.jointSelf !== false, ...(o.self5 && !o.self5.only ? { same: true } : {}), ...(o.self6joint ? { c6: (cl, x) => o.self6joint(cl, { ...x, draped, ctx }) } : {}), ...(o.jointMetric6 ? { metric6: true } : {}) });   // CLOTH6 (opt-in self6joint, jointMetric6)   // (self5.only: the joint as before)
      if (o.untangle) for (const r of draped) o.untangle(r.cl, 'joint', r.id, ctx);   // CLOTH5 (opt-in)
      for (const r of draped) { r.X = r.cl.X; refreshRec(h, ctx, r); }
      if (o.cache) st.mem.set(stackKey, Object.fromEntries(draped.map(r => [r.id, Float64Array.from(r.X)]))); } }
  // the guard: every inner particle inside each garment over it that covers it (outer surfaces are the settled ones)
  const guard = [];
  if (o.guard) for (let i = 0; i < draped.length; i++) for (let j = i + 1; j < draped.length; j++) { const A = draped[i], B = draped[j]; if (!C.under.get(B.id).includes(A.id)) continue;
    // drawn against drawn: the inner's visible cloth (its hidden tail under a waistband may cross nothing that shows) against the outer's
    if (!B.visSurf) continue; const g = LY.layerGap(A.fabric, B.fabric).hard * 0.5, hid = Uint8Array.from(A.solved.visCore || [], v => (v ? 0 : 1)), skip = A.solved.visCore ? hid : A.solved.frozen;
    const before = LY.outsideOf(A.X, A.G.np, B.visSurf, { gap: 0, skip }), cr0 = LY.crossings({ X: A.X, tris: A.visTris }, { X: B.X, tris: B.visTris });
    const mv = o.guard === 'move' ? LY.keepInside(A.X, A.G.np, B.visSurf, { gap: g, skip, floor: ctx.bodyPosed, floorGap: GAP_SKIN * 0.5, maxMove: 0.015 }) : { moved: 0, maxMm: 0 }, cr = LY.crossings({ X: A.X, tris: A.visTris }, { X: B.X, tris: B.visTris });
    if (mv.moved) refreshRec(h, ctx, A); guard.push({ inner: A.id, outer: B.id, outside: before.outside, crossingsBefore: cr0.crossings, moved: mv.moved, maxMoveMm: mv.maxMm, crossings: cr.crossings, edges: cr.edges }); }
  if (o.carry?.probe) o.carry.probe('joint', draped, ctx, h);   // CARRY (opt-in): the probes' view after the joint settle and the guard
  if (o.collect) for (const r of draped) bakes[r.id] = r.X;
  // ---- write back, riding parts, the CLOTH_REST contract (and then the cull of covered cloth; the guard's 'shown' counts follow it)
  const parents = []; for (const r of draped) if (r.meshes) for (const out of writeBack(h, ctx, r, shared)) parents.push({ k: r.L.d.key || r.id, m: out.m, rest: out.rest, now: out.now, liveRest: out.liveRest, liveNow: out.liveNow });
  for (const r of draped) if (r.pattern) { const m = writePattern(h, ctx, r); r.meshes = [m]; r.G.meshes = [{ m, pid: Int32Array.from({ length: r.G.np }, (_, i) => i) }]; }
  // a rim past a rolled sleeve's new cut (the c7 cuff binding) is not drawn: the sleeve no longer reaches it
  for (const pr of parts) { if (!pr.m.visible || !pr.name.startsWith('rim')) continue; const par = parents.find(q => q.k === pr.parent); const U = par?.m.material.uniforms_c6?.cHem?.value; if (!U || pr.parent !== 'top') continue;
    const A = pr.m.geometry.attributes.aHero?.array; if (!A) continue; let s2 = 0, k = 0, arm = 0; for (let v = 0; v < A.length / 4; v++) { if (A[v * 4] > 2.5 && A[v * 4] < 5.5) { s2 += A[v * 4 + 1]; arm++; } k++; }
    if (arm > k * 0.5 && s2 / arm > U.x + 0.05) pr.m.visible = false;
    // the binding of a tucked top's tuck line rides inside the trousers: hidden (it showed through the jeans as red patches, c1 and c2)
    const U2 = par.m.material.uniforms_c6?.cHem2?.value, topRec = draped.find(r => r.meshes?.includes(par.m)), R0 = D.keepRest(pr.m).position; if (U2 && topRec?.underBottoms && arm < k * 0.5) { let ys = 0; for (let v = 0; v < R0.length / 3; v++) ys += R0[v * 3 + 1]; if (ys / (R0.length / 3) < U2.y + 0.03) pr.m.visible = false; } }
  const attached = ride(h, parts.filter(p => p.m.visible), parents, shared); D.restShared(h, shared);
  const culled = o.cull === false ? [] : cullCovered(C, draped, { side: !!o.cullSide });
  const skinCover = o.skinCover && o.cull !== false ? coverSkin(h, ctx, draped) : null;   // HOOKS H3: hero.js's aCover from the same test (opt-in)
  for (const g of guard) { const A = recs.get(g.inner), B = recs.get(g.outer); if (!A?.cov) { g.shown = g.crossings; continue; } const T = A.visTris.filter((_, i, T2) => { const t = i - (i % 3); return !(A.cov[T2[t]] && A.cov[T2[t + 1]] && A.cov[T2[t + 2]]); });
    g.shown = LY.crossings({ X: A.X, tris: T }, { X: B.X, tris: B.visTris }).crossings; }   // crossings among the inner's triangles still drawn
  // ---- measures over the stack
  const measures = stackMeasures(h, ctx, C, recs, rigid);
  const report = { stackKey, order: C.order, notes: C.notes, cycles: C.cycles, garments: reps, joint, guard, culled, attached, measures, ms: Math.round(now() - t0), fromDisk, ...(skinCover ? { skinCover } : {}), ...(carry ? { carry } : {}) };
  const session = { h, outfit, C, keys, recs, report, bakes: o.collect ? { [stackKey]: packStack(stackKey, Object.fromEntries(Object.entries(bakes).map(([k, v]) => [k, v]))) } : null,
    crowd: (colorOf) => crowdOf(outfit, colorOf || (L => colorOfLayer(h, L, meshOf))),
    remove: async id => dressPerson(h, without(outfit, id), opts), add: async (layer, at) => dressPerson(h, withLayer(outfit, layer, at), opts), dirty: id => dirtyAfter(C, id) };
  h._stack = session; return session;
}
// ---------------------------------------------------------------- CLOTH3: the carry (sewn in the A-pose, carried to the pose)
// The judge (c8) and K3: sewing K2's panels in the standing pose (placed in bind, posed by skin weights, then sewn) left 10-16 mm seam gaps
// that the weld closed by force: the crumpled shirt fronts, the trouser seats. Sewn and settled in the A-pose the same panels close to
// a few mm (K2's stand-in). Here the bones go from bind to the pose in `steps` steps (slerp, smoothstep in time); at each step every draped
// garment, inner first, is carried by the skin from the last step (bind through the last step's matrices, posed through this one's:
// pinned and frozen particles, the waistband's hold and a tucked tail's frozen depth, ride exactly), its velocity cleared, its tucked tail's
// soft pins re-aimed at the body, and settled T s against the body, the boots and the layers under it as they are at this step (the
// collider refitted: context() of this pose). A last step settles `settle` s in the pose; then the trouser hems are kept out of the boots
// (a particle under the boot's top found inside its shell moves out along its normal: the shards through the boots). opts.carry: true or
// { steps (10), T (0.06 s), settle (0.35 s), bootGuard (true), reweight (true: a sewn garment's weights from where it settled), smoothW (6 passes) }.
function carryRun(h, C, recs, to, o, ctxOf, buildRigid) {
  const c = { steps: 10, T: 0.06, settle: 0.35, bootGuard: true, ...(typeof o.carry === 'object' ? o.carry : {}) }, t0 = now();
  const draped = C.order.map(x => recs.get(x)).filter(r => r && r.cl); if (C.order.some(x => recs.get(x)?.belt)) throw new Error('stack carry: belts are not carried yet');
  const q0 = h.bones.map(b => b.quaternion.clone()), p0 = h.bones.map(b => b.position.clone()), tmp = [0, 0, 0];
  let ctxP = ctxOf(), ctx = ctxP, rigid = buildRigid(ctx); const rep = { steps: c.steps, T: c.T, settle: c.settle, stepMs: [], bootOut: 0 };
  if (c.reweight !== false) for (const r of draped) if (r.reweight) r.reweight(r.cl.X);
  const soft0 = new Map(draped.map(r => [r, { V: Int32Array.from(r.cl.aV), X: Float64Array.from(r.cl.aX), A: Float64Array.from(r.cl.aAl) }]));   // the garment's own soft pins (a tucked tail)
  if (c.probe) c.probe(0, draped, ctx, h);   // CARRY (round 3b, opt-in): a callback per step (k, draped, ctx, hero) for the probes
  // CARRY (round 3b, opt-in c.hold3): the tucked band held INSIDE the trousers at every step (tuckCeiling: the trousers' upper band as
  // a ceiling, normals turned in, for the shirt particles sewn below the waistband's top); every garment carried by the skin BEFORE any
  // settles (the shirt settles against the trousers as they are at this step, not the last); the tail's soft pins kept current for the
  // joint settle after the carry (they were left at their A-pose targets, which pulled the tail sideways out of the waistband)
  const pairT = c.hold3 ? tuckPairs(C, draped) : [];
  for (let k = 1; k <= c.steps + 1; k++) { const last = k === c.steps + 1, ts = now();
    if (!last) { const s = k / c.steps, e = s * s * (3 - 2 * s); h.bones.forEach((b, i) => { b.quaternion.slerpQuaternions(q0[i], to.q[i], e); b.position.lerpVectors(p0[i], to.p[i], e); }); if (k === c.steps) { h.bones.forEach((b, i) => { b.quaternion.copy(to.q[i]); b.position.copy(to.p[i]); }); h._flex = to.flex; }
      h.update(); ctx = ctxOf(); rigid = buildRigid(ctx); }
    if (!last) for (const r of draped) { const X = r.cl.X, np = r.G.np, S = ctx.S, cl = r.cl;
      const Lb = new Float64Array(np * 3); for (let p = 0; p < np; p++) { blendInverse(r.G.SI, r.G.SW, p, ctxP.M, X[p * 3] / S, X[p * 3 + 1] / S, X[p * 3 + 2] / S, tmp, 0); Lb[p * 3] = tmp[0]; Lb[p * 3 + 1] = tmp[1]; Lb[p * 3 + 2] = tmp[2]; }
      if (c.sub > 1 && cl.c6) {   // CLOTH6 (opt-in, with o.self6): the skin's jump in `sub` pieces, each checked continuously against the side it started on
        const Xn = new Float64Array(np * 3); skinPose(Lb, r.G.SI, r.G.SW, ctx.M, Xn, S); const D3 = new Float64Array(np * 3), P0 = new Float64Array(np * 3); for (let i = 0; i < np * 3; i++) D3[i] = (Xn[i] - X[i]) / c.sub;
        for (let u = 0; u < c.sub; u++) { cl.c6.refresh(X); P0.set(X); for (let i = 0; i < np * 3; i++) X[i] += D3[i]; for (let it = 0; it < (c.subIters ?? 4); it++) cl.c6.project(X, P0, { friction: false, maxPush: c.subPush ?? 0.004, fast: false }); } }
      else if (c.sub > 1 && cl.triTh) {   // CLOTH5 (opt-in carry.sub with o.self5): the skin's jump taken in `sub` pieces, the self-collision's sides found before
        // each piece and projected after it (one jump of the skin drove the inside of a bending elbow, the armpit and the fork through itself,
        // and the solver's side memory, found after the jump, then kept the crossing)
        const Xn = new Float64Array(np * 3); skinPose(Lb, r.G.SI, r.G.SW, ctx.M, Xn, S); const D3 = new Float64Array(np * 3); for (let i = 0; i < np * 3; i++) D3[i] = (Xn[i] - X[i]) / c.sub;
        const ev = cl.triEvery, mp = cl.triMaxPush; cl.triMaxPush = c.subPush ?? 0.003;
        for (let u = 0; u < c.sub; u++) { cl._triPairs(); for (let i = 0; i < np * 3; i++) X[i] += D3[i]; for (let it = 0; it < (c.subIters ?? 4); it++) cl._triProject(); }
        cl.triEvery = ev; cl.triMaxPush = mp; }
      else skinPose(Lb, r.G.SI, r.G.SW, ctx.M, X, S);
      cl.V.fill(0);
      // the cuffs held where the skin carries them (soft, 1e-5 m/N), with the garment's own pins
      if (r.cuffP && c.cuffHold !== false) { const s0 = soft0.get(r), L = []; for (let a = 0; a < s0.V.length; a++) L.push({ i: s0.V[a], x: [s0.X[a * 3], s0.X[a * 3 + 1], s0.X[a * 3 + 2]], alpha: s0.A[a] });
        for (let p = 0; p < np; p++) if (r.cuffP[p]) L.push({ i: p, x: [X[p * 3], X[p * 3 + 1], X[p * 3 + 2]], alpha: 1e-5 }); cl.attach(L); } }
    for (const r of draped) { const X = r.cl.X, np = r.G.np, F = r.F, cl = r.cl, S = ctx.S;
      for (let a = 0; a < cl.aV.length; a++) { const i = cl.aV[a]; if (r.cuffP && r.cuffP[i]) continue; const q = ctx.bodyPosed.closest(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], 0.1); if (!q) continue; const t = TAIL_GAP + F.h / 2; cl.aX[a * 3] = q.px + q.nx * t; cl.aX[a * 3 + 1] = q.py + q.ny * t; cl.aX[a * 3 + 2] = q.pz + q.nz * t; }
      const under = (r.underIds || []).map(y => recs.get(y)).filter(u => u && u.surf && !u.belt), tail = r.solved.tail, trisC = r.solved.trisC;
      const gB = Float64Array.from({ length: np }, (_, i) => (tail && tail[i] ? TAIL_GAP : GAP_SKIN) + F.h / 2), Ap = LY.particleAreas(X, trisC, np);
      const surf = [{ mesh: ctx.bodyPosed, gap: gB, mu: F.mu, reach: 0.05 }, ...rigid.map(R => ({ mesh: R.surf, gap: R.h / 2 + F.h / 2 + 0.0015, mu: F.mu, reach: 0.05 })), ...under.map(u => LY.layerContact({ surf: u.surf, fabric: u.fabric }, r.fabric, Ap, { mu: F.mu }))];
      for (const pr of pairT) if (pr.top === r) { const cz = tuckCeiling(pr.bottom, ctx); if (cz) surf.push({ mesh: cz.mesh, gap: LY.layerGap(r.fabric, pr.bottom.fabric).hard, mu: 0.3, reach: 0.03, garment: true, mask: pr.mask }); }
      const ct = new Contacts(np, surf, { safe: true }); cl.run(last ? c.settle : c.T, { hz: o.hz, contacts: ct, every: 6, selfEvery: 30 });
      if (o.untangle) o.untangle(cl, 'carry' + k, r.id, ctx);   // CLOTH5 (opt-in): crossings made by this step undone before the next
      // the hems kept out of the boots: below the boot's top, a particle inside a boot's shell (signed distance under the gap) moves out
      if (last && c.bootGuard && r.L.d.part !== 'top' && (r.L.d.part === 'bottom' || r.pattern)) for (const R of rigid) { if (!/boot/.test(R.id)) continue; const g = R.h / 2 + F.h / 2 + 0.0015;
        for (let p = 0; p < np; p++) { if (X[p * 3 + 1] > 0.32 * S || cl.W[p] === 0) continue; const q = R.surf.closest(X[p * 3], X[p * 3 + 1], X[p * 3 + 2], 0.08); if (!q || q.edge || q.d >= g) continue; const kk = g - q.d; X[p * 3] += q.nx * kk; X[p * 3 + 1] += q.ny * kk; X[p * 3 + 2] += q.nz * kk; rep.bootOut++; } }
      const sew = r.rep?.sew, ms = r.rep?.ms ?? 0; finishOne(h, ctx, r, { ...r.solved, ct: last ? ct : null, t0: now(), nf: 0 }); r.rep.ms = ms; if (sew) r.rep.sew = sew; }
    rep.stepMs.push(Math.round(now() - ts)); ctxP = ctx; if (c.probe) c.probe(k, draped, ctx, h); }
  if (c.hold3) { for (const r of draped) { if (!r.solved.soft?.length) continue; const at = new Map(); for (let a = 0; a < r.cl.aV.length; a++) at.set(r.cl.aV[a], a);
      r.solved.soft = r.solved.soft.map(sp => { const a = at.get(sp.i); return a == null ? sp : { i: sp.i, x: [r.cl.aX[a * 3], r.cl.aX[a * 3 + 1], r.cl.aX[a * 3 + 2]], alpha: sp.alpha }; }); }
    rep.hold3 = { pairs: pairT.map(pr => [pr.top.id, pr.bottom.id, pr.n]) }; }
  rep.ms = Math.round(now() - t0); for (const r of draped) r.rep.carry = { penMax: r.rep.penMax, stretchMean: r.rep.stretchMean };
  return { ctx, rigid, report: rep, pairs: pairT };
}
// CARRY (round 3b): a tucked top and the bottom over it (a sewn top with a tuck line, the sewn bottom whose waistband it goes under), with
// the top's particles that belong inside the bottom: sewn below the waistband's top (its A-pose y under tuckTop - 5 mm), not a sleeve
function tuckPairs(C, draped) {
  const out = []; for (const top of draped) { if (!top.pattern || top.L.tuckTop == null || (top.L.rules?.tuck ?? 'in') !== 'in') continue;
    const bottom = draped.find(b => b !== top && b.pattern && C.under.get(b.id)?.includes(top.id) && /titan|trouser|onyx/.test(b.pattern.design || b.L.pattern?.design || '')); if (!bottom) continue;
    const np = top.G.np, mask = new Uint8Array(np); let n = 0; for (let p = 0; p < np; p++) if (!(top.limb && top.limb[p]) && top.G.Xb[p * 3 + 1] < top.L.tuckTop - 0.005) { mask[p] = 1; n++; }
    out.push({ top, bottom, mask, n }); }
  return out; }
// the bottom's upper band (from 1 cm over its waistband's top to 16 cm under it), posed as it is now, its normals turned IN: a ceiling the
// tucked band is held inside (the edges are not contacts: a particle above the waistband's top edge is free)
function tuckCeiling(bottom, ctx) {
  const X = bottom.cl.X, T = bottom.solved.trisC; let top = -Infinity; for (const hd of bottom.pattern.holds || []) for (const i of hd.ids) top = Math.max(top, X[i * 3 + 1]); if (!Number.isFinite(top)) return null;
  const keep = []; for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c2 = T[t + 2], y0 = Math.min(X[a * 3 + 1], X[b * 3 + 1], X[c2 * 3 + 1]); if (y0 > top - 0.16) keep.push(a, b, c2); }
  if (keep.length < 30) return null; const tris = Int32Array.from(keep), N = D.orientOut(X, tris, ctx.bodyPosed); for (let i = 0; i < N.length; i++) N[i] = -N[i];
  return { mesh: compactSurf(X, tris, N), top }; }
// ---------------------------------------------------------------- what is covered is not drawn
// An inner garment's triangles that lie under an outer garment's drawn cloth, away from its edges (CULL_RINGS of the outer's triangles from
// any boundary: a neck opening, an armhole, a cuff, a hem), are left out of the inner mesh's index (made degenerate in place, so
// restore() brings them back). The cloth is still there for the solver and as a collider; it is only not DRAWN where nothing could see
// it, so a fold of an inner layer that still crosses the outer (the measure above counts them) cannot show through it. This is the
// geometric half of the H3 hook (a garment-driven skin cull) applied to garments.
function cullCovered(C, draped, { side = false } = {}) {   // side (K3, opt-in): only inner cloth BEHIND the outer surface (a cuff hanging beside the trousers is not under them)
  const out = [];
  for (let j = 0; j < draped.length; j++) { const B = draped[j], S = B.visSurf; if (!S || !S.bnd) continue;
    // ring distance of each of the outer's drawn vertices from its boundary
    const ring = new Int32Array(S.n).fill(99), q0 = []; for (let v = 0; v < S.n; v++) if (S.bnd[v]) { ring[v] = 0; q0.push(v); }
    for (let r = 0, f = q0; r < 6 && f.length; r++) { const nx = []; for (const v of f) for (let k = S.no[v]; k < S.no[v + 1]; k++) { const u = S.nbr[k]; if (ring[u] > r + 1) { ring[u] = r + 1; nx.push(u); } } f = nx; }
    B._deep = t => ring[S.tris[t * 3]] >= CULL_RINGS && ring[S.tris[t * 3 + 1]] >= CULL_RINGS && ring[S.tris[t * 3 + 2]] >= CULL_RINGS; }
  for (let i = 0; i < draped.length; i++) { const A = draped[i]; if (!A.meshes) continue; const overs = draped.slice(i + 1).filter(B => B.visSurf && B._deep && C.under.get(B.id)?.includes(A.id)); if (!overs.length && !A.pattern) continue;
    const cov = new Uint8Array(A.G.np); if (A.pattern && A.solved.visCore) for (let p = 0; p < A.G.np; p++) if (!A.solved.visCore[p]) cov[p] = 1;   // a sewn garment has no shader cuts: what is not drawn is culled here
    // side mode: a sleeve hanging against the trousers is never culled (its forearm opened in holes)
    for (let p = 0; p < A.G.np; p++) if (!cov[p] && !(side && A.limb && A.limb[p])) for (const B of overs) { const q = B.visSurf.closest(A.X[p * 3], A.X[p * 3 + 1], A.X[p * 3 + 2], 0.03); if (q && !q.edge && B._deep(q.tri) && (!side || q.d < -0.001)) { cov[p] = 1; break; } }
    let n = 0, tot = 0; for (const { m, pid } of A.G.meshes) { const g = m.geometry, ix = g.index.array; for (let t = 0; t < ix.length; t += 3) { tot++; if (cov[pid[ix[t]]] && cov[pid[ix[t + 1]]] && cov[pid[ix[t + 2]]]) { ix[t + 1] = ix[t]; ix[t + 2] = ix[t]; n++; } } g.index.needsUpdate = true; }
    A.cov = cov; out.push({ id: A.id, under: overs.map(B => B.id), trisHidden: n, of: tot }); }
  return out;
}
// a cached own-solve: rebuild the record from its particles' posed positions (no solving)
function restoreOne(h, ctx, rec, under, rigid, o, X) {
  const T = o.T; o.T = 0; solveOne(h, ctx, rec, under, rigid, o); o.T = T; rec.cl.X.set(X); rec.X = rec.cl.X; refreshRec(h, ctx, rec, false); rec.rep.ms = 0; }
function refreshRec(h, ctx, r, ride = true) { const s = r.solved, ms = r.rep?.ms ?? 0; finishOne(h, ctx, r, { ...s, ct: null, t0: now(), nf: ride ? s.nf : 0 }); r.rep.ms = ms; }   // ride: false when X came from a bake (it holds the ridden strip already)
function colorOfLayer(h, L, meshOf) { const m = meshOf.get(L.id)?.[0]; const c = m?.material?.uniforms_c6?.cA?.value; return c ? '#' + c.getHexString() : L.color || null; }

// ---------------------------------------------------------------- measures a stack is read by
function stackMeasures(h, ctx, C, recs, rigid) {
  const out = {}, draped = C.order.map(x => recs.get(x)).filter(r => r && r.cl);
  // the boot under the trouser hem: the hem ring (along ~ the cut) against the boots
  const tr = draped.filter(r => r.L.d.part === 'bottom').slice(-1)[0], boots = rigid.find(r => r.id && C.layers.get(r.id).d.key === 'boots');
  if (tr && boots) { const G = tr.G, hemLc = tr.meshes[0].material.uniforms_c6.cHem.value.y, ring = []; let n = 0, ins = 0, dmin = 1, yF = 0, yB = 0, nF = 0, nB = 0, onBoot = 0;
    for (let p = 0; p < G.np; p++) { const r = G.AH[p * 4], lc = G.AH[p * 4 + 1]; if (!(r === RG.shin || r === RG.foot) || Math.abs(lc - hemLc) > 0.03) continue; n++; const q = boots.surf.closest(tr.X[p * 3], tr.X[p * 3 + 1], tr.X[p * 3 + 2], 0.1);
      if (q) { dmin = Math.min(dmin, q.d); if (q.d < 0) ins++; if (q.d < 0.006) onBoot++; } ring.push(p); }
    const zc = { L: [0, 0], R: [0, 0] }; for (const p of ring) { const sd = G.AH[p * 4 + 2] > 0 ? 'L' : 'R'; zc[sd][0] += tr.X[p * 3 + 2]; zc[sd][1]++; }
    for (const p of ring) { const sd = G.AH[p * 4 + 2] > 0 ? 'L' : 'R', z0 = zc[sd][0] / Math.max(1, zc[sd][1]), dz = tr.X[p * 3 + 2] - z0; if (dz > 0.02) { yF += tr.X[p * 3 + 1]; nF++; } else if (dz < -0.02) { yB += tr.X[p * 3 + 1]; nB++; } }
    let hemR = 0, k = 0; for (let p = 0; p < G.np; p++) { const r = G.AH[p * 4], lc = G.AH[p * 4 + 1]; if ((r === RG.shin || r === RG.foot) && Math.abs(lc - hemLc) <= 0.03) { const xR = D.poseP(ctx, G.Xb.subarray(p * 3, p * 3 + 3), G.SI.subarray(p * 4, p * 4 + 4), G.SW.subarray(p * 4, p * 4 + 4)); hemR += xR[1]; k++; } }
    out.hem = { verts: n, insideBoot: ins, minToBootMm: dmin * 1000, restingOnBoot: onBoot, yFrontCm: nF ? yF / nF * 100 : null, yBackCm: nB ? yB / nB * 100 : null, yShellCm: k ? hemR / k * 100 : null }; }
  // accumulated thickness: the outermost layer over the skin at the cuff, the collar and the waist (mean distance, mm) against the sum of the
  // compressed thicknesses of the layers there
  const at = (pick, zone) => { let best = null; for (const r of draped) { const G = r.G; let any = false; for (let p = 0; p < G.np && !any; p++) if (!r.solved.frozen[p] && pick(r, p)) any = true; if (any) best = r; } if (!best) return null;
    const d = LY.depthOver(ctx.bodyPosed, best.X, best.G.np, p => !best.solved.frozen[p] && pick(best, p), 0.15); const sum = draped.filter(r => { const G = r.G; for (let p = 0; p < G.np; p++) if (!r.solved.frozen[p] && pick(r, p)) return true; return false; }).reduce((a, r) => a + LY.thick(r.fabric).Tm, 0);
    return { outer: best.id, n: d.n, layers: draped.filter(r => { for (let p = 0; p < r.G.np; p++) if (!r.solved.frozen[p] && pick(r, p)) return true; return false; }).map(r => r.id), meanMm: d.meanMm, minMm: d.minMm, sumTmMm: sum * 1000, skinGapMm: GAP_SKIN * 1000, zone }; };
  const K = draped[0]?.kit; if (K) { const yW = K.yW, yS = K.yS;
    out.waist = at((r, p) => isTrunk(r.G.AH[p * 4]) && Math.abs(r.G.Xb[p * 3 + 1] - (yW + 0.02)) < 0.015 && r.G.Xb[p * 3 + 2] > 0, 'waist, front');
    out.collar = at((r, p) => isTrunk(r.G.AH[p * 4]) && Math.abs(r.G.Xb[p * 3 + 1] - (yS - 0.06)) < 0.015 && r.G.Xb[p * 3 + 2] < 0, 'upper back under the collar');
    out.cuff = at((r, p) => isArm(r.G.AH[p * 4]) && Math.abs(r.G.AH[p * 4 + 1] - 0.6) < 0.08, 'upper arm'); }
  return out;
}

// ---------------------------------------------------------------- K2's sewn garments (pattern:<name>)
// placed panels posed through the skin weights of the nearest body vertex, sewn (sew.js), welded, then settled like any garment; the
// result is a SkinnedMesh of its own on the hero's skeleton (part 7: no hero cuts; its edges are the pattern's).
function solvePattern(h, ctx, L, under, rigid, o) {
  const t0 = now(), pat = L.pattern, fabMap = typeof L.fabric === 'string' ? { body: L.fabric } : (L.fabric || { body: 'chambray' }), S0 = SEW.prepare(pat, fabMap), S = ctx.S;
  let fused = L.interfacing ? SEW.interfacing(S0, pat, L.interfacing) : null;   // CLOTH4 (opt-in): fused interlining as stiffer cloth (sew.js interfacing)
  // CLOTH5 (opt-in L.hemBand5 { band, bendX, stretchX, shearX }): the turned hem of a trouser leg as a stiffer band (the lowest `band` m as placed)
  if (L.hemBand5) { let y0 = Infinity; for (let i = 0; i < S0.n; i++) y0 = Math.min(y0, S0.X[i * 3 + 1]); const hb = SEW.interfacing(S0, pat, { ...L.hemBand5, hemY: y0 + L.hemBand5.band }); fused = fused ? { ...fused, hem5: hb } : { tris: 0, hem5: hb }; }
  const B = h.body.geometry, BP = B.attributes.position.array, BI = B.attributes.skinIndex.array, BW = B.attributes.skinWeight.array, nb = BP.length / 3, cell = 0.03, ic = 1 / cell, H = new Map(), key = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);
  for (let v = 0; v < nb; v++) { const k = key(Math.floor(BP[v * 3] * S * ic), Math.floor(BP[v * 3 + 1] * S * ic), Math.floor(BP[v * 3 + 2] * S * ic)); const Lh = H.get(k); if (Lh) Lh.push(v); else H.set(k, [v]); }
  // poseBySide (K3, opt-in): a sleeve takes its weights from the arm only, a leg panel from its own side only (the nearest body vertex of
  // a sleeve's underarm was the torso's, of a trouser fork the other leg's: posed into idleStance they tore and tangled)
  const BAH = B.attributes.aHero?.array, okV = (v, f) => !f || f(v);
  const near = (x, y, z, f = null) => { let best = 0, bd = Infinity; for (let r = 1; r < 6 && bd === Infinity; r++) { const ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) { const Lh = H.get(key(ci + a, cj + b, ck + c)); if (!Lh) continue; for (const v of Lh) { if (!okV(v, f)) continue; const d = (BP[v * 3] * S - x) ** 2 + (BP[v * 3 + 1] * S - y) ** 2 + (BP[v * 3 + 2] * S - z) ** 2; if (d < bd) { bd = d; best = v; } } } } return best; };
  const n0 = S0.n, SI = new Uint16Array(n0 * 4), SW = new Float32Array(n0 * 4); const sideF = !o.poseBySide || !BAH ? () => null : i => { const nm = pat.panels[S0.panelOf[i]].name, arm = r => r >= 2.5 && r <= 5.5;
    if (/^(sleeve|cuff)/.test(nm)) return v => arm(BAH[v * 4]); if (/^(front|back)[LR]$/.test(nm) && /titan|trouser|onyx/.test(pat.design || '')) { const sg = nm.endsWith('L') ? 1 : -1; return v => BP[v * 3] * sg > -0.004 && !arm(BAH[v * 4]); } return v => !arm(BAH[v * 4]) || /^(sleeve|cuff)/.test(nm); };
  for (let i = 0; i < n0; i++) { const v = near(S0.X[i * 3], S0.X[i * 3 + 1], S0.X[i * 3 + 2], sideF(i)); for (let c = 0; c < 4; c++) { SI[i * 4 + c] = BI[v * 4 + c]; SW[i * 4 + c] = BW[v * 4 + c]; } }
  const X0 = D.poseP(ctx, S0.X, SI, SW), F = S0.fabs[0], fabric = S0.fabNames[0];
  const coll = [{ mesh: ctx.bodyPosed, gap: GAP_SKIN + F.h / 2, mu: 0.3, reach: 0.06 }, ...(o.sewRigid === false ? [] : rigid).map(R => ({ mesh: R.surf, gap: R.h / 2 + F.h / 2 + 0.0015, reach: 0.05 })), ...(o.sewUnder === false ? [] : under).filter(u => u.surf).map(u => ({ mesh: u.surf, gap: LY.layerGap(u.fabric, fabric).soft, mu: 0.3, reach: 0.05, garment: true }))];
  // K3 (opt-in): sewRigid false keeps the boots out of the sewing phase (they dragged sewn trousers 50 cm down), sewUnder false the garments
  // under it (trousers sewn against a tucked shirt's open tail band tangled: 25 mm seam gaps); o.sew { T, hz, iters } for finer meshes
  if (o.placed6) o.placed6(X0, S0, pat, ctx, L);   // CLOTH6 (opt-in): the placed panels' crossings smoothed out before the sew (cloth6/untangle6.js smoothPlaced)
  if (o.sewProbe) o.sewProbe('placed', X0, S0, pat, ctx, null);   // CARRY (round 3b, opt-in): the probes' view of the sewing
  // CARRY (round 3b, opt-in o.sewCuffs): the cuffs held at the wrist where place.js put them while the panels are sewn and settled (the
  // cuff-join stitches pulled each cuff ~35 mm up the forearm to meet a sleeve sewn up into the armhole: CLOTH3's cuffs 6.5 cm up the
  // forearm were sewn there in the A-pose, before any carry, which is why holding them during the carry changed nothing)
  // held on PLANES normal to the forearm (free to turn round the wrist: a cuff placed a little rotated against its sleeve has to turn to
  // meet it; pinned in place, cuffJoinR stayed 24 mm open)
  const cuffHold = []; if (o.sewCuffs) { const wr = {}; for (const sd of ['L', 'R']) { const w = ctx.J('wrist.' + sd), e = ctx.J('lowerarm01.' + sd), d = [w[0] - e[0], w[1] - e[1], w[2] - e[2]], l = Math.hypot(...d); wr[sd] = d.map(x => x / l); }
    // CLOTH4 (opt-in o.cuffJoinFree, m): the cuff's rows within this flat-pattern distance of its join seam are NOT held: held on their
    // planes, the join edge could not rise to the gathered sleeve and the cuff's top folded in (its inside showing: the cuff window)
    const freeJ = new Uint8Array(S0.n); if (o.cuffJoinFree > 0) for (const sm of pat.seams || []) { if (!/^cuffJoin/.test(sm.name || '')) continue; for (const sd2 of [sm.a, sm.b]) { if (!/^cuff[LR]$/.test(sd2.panel)) continue;
      const pn = pat.panels.find(p => p.name === sd2.panel), o0 = S0.off[sd2.panel], jv = Array.from(sd2.verts), m2 = pn.uv.length / 2; for (let li = 0; li < m2; li++) { let b = Infinity; for (const v of jv) b = Math.min(b, Math.hypot(pn.uv[li * 2] - pn.uv[v * 2], pn.uv[li * 2 + 1] - pn.uv[v * 2 + 1])); if (b < o.cuffJoinFree) freeJ[o0 + li] = 1; } } }
    for (let i = 0; i < S0.n; i++) { const nm = pat.panels[S0.panelOf[i]].name; if (/^cuff[LR]$/.test(nm) && !freeJ[i]) cuffHold.push({ i, x: [X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2]], n: wr[nm.slice(-1)], alpha: typeof o.sewCuffs === 'number' ? o.sewCuffs : 1e-7 }); } }
  // o.sewCuffs 'settle': the panels sewn free (the cuff-join seam closes as CLOTH3's did), the cuffs drawn back to the wrist only in the
  // A-pose settle after the weld (the sleeve slides down the arm; no seam is held open while it is sewn)
  const sw = SEW.sewPhase(S0, X0, coll, { ...(o.sew || {}), ...(o.self5?.only && !o.self5.only.includes(L.id) ? { selfEE: false } : {}), ...(o.sew6only && !o.sew6only.includes(L.id) ? { c6: null, untangle: null, self: true } : {}),   // CLOTH6 (opt-in sew6only: the garments sewn with self6)
 ...(cuffHold.length && o.sewCuffs !== 'settle' ? { hold: cuffHold } : {}) }), W = SEW.weldSewn(S0, sw.X);
  if (o.sewProbe) o.sewProbe('sewn', sw.X, S0, pat, ctx, null);
  const SIw = new Uint16Array(W.n * 4), SWw = new Float32Array(W.n * 4); for (let i = 0; i < n0; i++) { const j = W.map[i]; SIw.set(SI.subarray(i * 4, i * 4 + 4), j * 4); SWw.set(SW.subarray(i * 4, i * 4 + 4), j * 4); }
  const pin = new Uint8Array(W.n); for (const hd of W.holds) for (const i of hd.ids) pin[i] = 1;
  // tucked (a top under a bottom at the waist): its tail below the waistband's top is held snug on what is under it, as for a shell
  // tuckTorsoOnly (K3, opt-in): the tuck line acts on the body panels only (arms hang below it in idleStance: K2's sleeves and cuffs were
  // frozen and not drawn below the waistband's height)
  const limb = new Uint8Array(W.n); if (o.tuckTorsoOnly) for (let i = 0; i < S0.n; i++) { const nm = pat.panels[S0.panelOf[i]].name; if (/^(sleeve|cuff)/.test(nm)) limb[W.map[i]] = 1; }
  const softP = []; if ((L.rules?.tuck ?? 'in') === 'in' && L.tuckTop != null) for (let i = 0; i < W.n; i++) { if (W.X[i * 3 + 1] > L.tuckTop + 0.012 || limb[i]) continue; const q = ctx.bodyPosed.closest(W.X[i * 3], W.X[i * 3 + 1], W.X[i * 3 + 2], 0.1); if (!q) continue; const t = TAIL_GAP + F.h / 2; softP.push({ i, x: [q.px + q.nx * t, q.py + q.ny * t, q.pz + q.nz * t], alpha: 2e-6 }); }
  const tailP = new Uint8Array(W.n); for (const a of softP) tailP[a.i] = 1;
  // a tucked tail deeper than 7 cm under the waistband's top is not simulated (it cannot fold into the trousers as a real tail does, and
  // spanning the crotch it crossed them): it rides with the cloth above it and is not drawn (nor is anything 2 cm under the waistband)
  const frozenP = new Uint8Array(W.n), visP = new Uint8Array(W.n).fill(1); let nfP = 0;
  if (L.tuckTop != null && (L.rules?.tuck ?? 'in') === 'in') for (let i = 0; i < W.n; i++) { if (limb[i]) continue; const y = W.X[i * 3 + 1]; if (y < L.tuckTop - (o.tuckDraw ?? 0.02)) visP[i] = 0; if (y < L.tuckTop - (o.tuckFreeze ?? 0.07)) { frozenP[i] = 1; pin[i] = 1; nfP++; } }
  for (let k = softP.length - 1; k >= 0; k--) if (frozenP[softP[k].i]) softP.splice(k, 1);
  const keepT = []; for (let t = 0; t < W.tris.length / 3; t++) if (!(frozenP[W.tris[t * 3]] || frozenP[W.tris[t * 3 + 1]] || frozenP[W.tris[t * 3 + 2]])) keepT.push(t);
  const trisP = Int32Array.from(keepT.flatMap(t => [W.tris[t * 3], W.tris[t * 3 + 1], W.tris[t * 3 + 2]])), metP = Float64Array.from(keepT.flatMap(t => Array.from(W.metric.subarray(t * 6, t * 6 + 6)))), grP = Float64Array.from(keepT.flatMap(t => [W.grain[t * 2], W.grain[t * 2 + 1]])), tfP = Uint8Array.from(keepT, t => W.triFab[t]);
  // CLOTH5 (opt-in o.self5 { every, maxPush }): point-triangle and edge-edge self-collision with side memory in the A-pose settle and the
  // carry (without it a sewn garment's own folds had only the 6 mm particle repulsion on a 13.5 mm mesh: folds passed through themselves)
  // self5.only (CLOTH5, opt-in): the garments (stack ids) it applies to; the others solve as before
  const self5 = o.self5 && (!o.self5.only || o.self5.only.includes(L.id)) ? { selfTri: F.h / 2 + (o.self5.pad ?? 0.0008), selfTriEvery: o.self5.every ?? 6, selfTriEE: o.self5.ee !== false, selfTriMaxPush: o.self5.maxPush ?? 0.001, selfTriLast: !!o.self5.last } : {};
  const cl = new Cloth(W.X, trisP, F, { X0: W.X, pin, metric: metP, grain: grP, fabs: W.fabs, triFab: tfP, restAngle: W.restAngle, compress: 0.25, gravity: ctx.grav, damping: 6, vmax: 1, stretchIters: o.iters, slack: 0.015, self: 0.006, selfSkip: 4, ...self5 });
  if (o.self6) { cl._met6 = { metric: metP, grain: grP }; o.self6(cl, { stage: 'settle', id: L.id, F, ctx, frozen: frozenP }); }   // CLOTH6 (opt-in): cloth6/self6.js attached to the garment's cloth (settle and carry)
  if (o.untangle) o.untangle(cl, 'welded', L.id, ctx);   // CLOTH5 (opt-in): the sewn cloth's crossings undone before the settle
  const Ap = LY.particleAreas(W.X, trisP, W.n), surf = [{ mesh: ctx.bodyPosed, gap: Float64Array.from(tailP, t => (t ? TAIL_GAP : GAP_SKIN) + F.h / 2), mu: F.mu, reach: 0.05 }, ...rigid.map(R => ({ mesh: R.surf, gap: R.h / 2 + F.h / 2 + 0.0015, mu: F.mu, reach: 0.05 })), ...under.filter(u => u.surf).map(u => LY.layerContact({ surf: u.surf, fabric: u.fabric }, fabric, Ap, { mu: F.mu }))];
  const cuffW = []; if (cuffHold.length) { const seen = new Set(); for (const a of cuffHold) { const j = W.map[a.i]; if (seen.has(j) || frozenP[j]) continue; seen.add(j); const lf = o.cuffLift || 0; cuffW.push({ i: j, x: o.sewCuffs === 'settle' ? [a.x[0] - a.n[0] * lf, a.x[1] - a.n[1] * lf, a.x[2] - a.n[2] * lf] : [W.X[j * 3], W.X[j * 3 + 1], W.X[j * 3 + 2]], n: a.n, alpha: 1e-6 }); } }   // cuffLift (m): the cuff's target that far up the forearm from where place.js put it
  if (softP.length) cl.attach(softP); if (cuffW.length) cl.attachPlane(cuffW); const ct = new Contacts(W.n, surf, { safe: true }); cl.run(o.T, { hz: o.hz, contacts: ct, every: 6, selfEvery: 30 }); cl.warpIn = null;
  if (o.untangle) o.untangle(cl, 'settled', L.id, ctx);
  if (cuffW.length) cl.qV = null;   // the cuffs' hold was for the sewing and the settle in the A-pose only
  if (o.sewProbe) o.sewProbe('settled', cl.X, S0, pat, ctx, W);
  const nbW = D.neighbours(W.tris, W.n), G = { np: W.n, tris: W.tris, nb: nbW, SI: SIw, SW: SWw, AH: new Float64Array(W.n * 4), Xb: W.X, meshes: [] };
  const rec = { id: L.id, L, G, F, fabric, pattern: W, kit: null, meshes: null, underIds: [], limb: o.tuckTorsoOnly ? limb : null, ...(fused ? { c4fabs: { fabs: W.fabs, triFab: tfP, fused } } : {}) };
  // CLOTH3 (carry): the skin weights again from where the SETTLED cloth lies (the nearest body vertex its panel may take weights from), so
  // the carry moves a sleeve with the arm it now wraps (placed round the straight shoulder-wrist line, a lower sleeve took its weights from
  // the upper arm beside a forearm bent forward, and the carry left the forearm out of it). Called by carryRun in the A-pose only.
  // CLOTH3 (carry): the cuffs' particles (a buttoned cuff rides the wrist as the arm comes down; free, the sleeve was dragged up the
  // forearm by the cloth gathering at the armpit and ended 8 cm short of the wrist)
  rec.cuffP = new Uint8Array(W.n); for (let i = 0; i < n0; i++) if (/^cuff/.test(pat.panels[S0.panelOf[i]].name)) rec.cuffP[W.map[i]] = 1;
  rec.reweight = Xs => { const first = new Int32Array(W.n).fill(-1); for (let i = 0; i < n0; i++) if (first[W.map[i]] < 0) first[W.map[i]] = i;
    // a top's body panels take no leg weights (its tucked tail followed a thigh and came out of the trousers when the weight shifted)
    const top = !/titan|trouser|onyx/.test(pat.design || ''), legV = v => BAH && BAH[v * 4] > 7.5 && BAH[v * 4] < 10.5, limbW = new Uint8Array(W.n);
    for (let i = 0; i < n0; i++) if (/^(sleeve|cuff)/.test(pat.panels[S0.panelOf[i]].name)) limbW[W.map[i]] = 1;
    // CARRY (carry.cuffNoHand, opt-in): a sleeve and its cuff take the ARM's weights only, never the hand's (a cuff on the wrist took the wrist bone's
    // weights from the hand vertices next to it and turned with the hand's flexion, off the forearm)
    const noHand = !!o.carry?.cuffNoHand && BAH ? (v => BAH[v * 4] > 2.5 && BAH[v * 4] < 4.5) : null;   // opt-in (not in CARRY3: untested on the board)
    for (let j = 0; j < W.n; j++) { const f0 = noHand && limbW[j] ? noHand : sideF(first[j]), f = top && !limbW[j] ? (v => (!f0 || f0(v)) && !legV(v)) : f0; const v = near(Xs[j * 3], Xs[j * 3 + 1], Xs[j * 3 + 2], f); for (let c = 0; c < 4; c++) { SIw[j * 4 + c] = BI[v * 4 + c]; SWw[j * 4 + c] = BW[v * 4 + c]; } }
    // then smoothed over the cloth (o.carry.smoothW passes, default 6): nearest-vertex weights jump between neighbouring particles; the
    // posed cloth is smooth (simulated), but its bind shape (the inverse blend) and so its skinned NORMALS were not, and the page drew
    // pale hexagonal fans where a particle's matrix turned unlike its neighbours' (the shirt-front "blotches" at the yoke and chest)
    const passes = typeof o.carry === 'object' && o.carry.smoothW != null ? o.carry.smoothW : 6; if (!passes) return; const nbr = D.neighbours(W.tris, W.n);
    let Wm = Array.from({ length: W.n }, (_, j) => { const m = new Map(); for (let c = 0; c < 4; c++) if (SWw[j * 4 + c] > 0) m.set(SIw[j * 4 + c], (m.get(SIw[j * 4 + c]) || 0) + SWw[j * 4 + c]); return m; });
    for (let it = 0; it < passes; it++) Wm = Wm.map((m, j) => { if (limbW[j]) return m; const o2 = new Map(); for (const [b, w] of m) o2.set(b, w); const L = nbr[j]; for (const u of L) { if (limbW[u]) continue; for (const [b, w] of Wm[u]) o2.set(b, (o2.get(b) || 0) + w); } return o2; });   // sleeves and cuffs keep the arm's own weights
    for (let j = 0; j < W.n; j++) { const top = [...Wm[j]].sort((a, b) => b[1] - a[1]).slice(0, 4), sm = top.reduce((a, q) => a + q[1], 0) || 1; for (let c = 0; c < 4; c++) { SIw[j * 4 + c] = top[c] ? top[c][0] : 0; SWw[j * 4 + c] = top[c] ? top[c][1] / sm : 0; } } };
  finishOne(h, ctx, rec, { cl, frozen: frozenP, X0: W.X, XR: W.X, P: W.X, E: null, pin, soft: softP, tail: tailP, trisC: trisP, visCore: visP, nf: nfP, warp: null, restAngle: W.restAngle, t0, ct, gapBody: GAP_SKIN + F.h / 2 });
  rec.rep.sew = { panels: pat.panels.length, stitches: sw.stitches, seamGapMm: sw.seamGapMm, sewMs: sw.ms, welded: W.n };
  return rec;
}
// the posed height of a sewn bottom's waistband (its 'waistband' hold vertices as placed, posed by the nearest body vertex's weights): mean y
function patternWaistY(h, ctx, pat) {
  const B = h.body.geometry, BP = B.attributes.position.array, BI = B.attributes.skinIndex.array, BW = B.attributes.skinWeight.array, S = ctx.S, nb = BP.length / 3, pts = [];
  for (const hd of pat.holds || []) { if (hd.kind !== 'waistband') continue; const pn = pat.panels.find(q => q.name === hd.panel); if (!pn) continue; for (const v of hd.verts) pts.push([pn.X[v * 3], pn.X[v * 3 + 1], pn.X[v * 3 + 2]]); }
  if (!pts.length) return (h.hems.waistY + 0.05) * S; let ys = 0;
  for (const q of pts) { let bv = 0, bd = Infinity; for (let v = 0; v < nb; v++) { const d = (BP[v * 3] * S - q[0]) ** 2 + (BP[v * 3 + 1] * S - q[1]) ** 2 + (BP[v * 3 + 2] * S - q[2]) ** 2; if (d < bd) { bd = d; bv = v; } }
    ys += D.poseP(ctx, Float64Array.from(q), BI.subarray(bv * 4, bv * 4 + 4), BW.subarray(bv * 4, bv * 4 + 4))[1]; }
  return ys / pts.length;
}
function writePattern(h, ctx, r) {
  const W = r.pattern, G = r.G, n = W.n, tmp = [0, 0, 0], bind = new Float32Array(n * 3); for (let p = 0; p < n; p++) { blendInverse(G.SI, G.SW, p, ctx.M, r.X[p * 3] / ctx.S, r.X[p * 3 + 1] / ctx.S, r.X[p * 3 + 2] / ctx.S, tmp, 0); bind.set(tmp, p * 3); }
  const st = h._stackState; let m = st.meshes.get(r.id);
  if (!m) { const BA = h.body.geometry.attributes.position.constructor, g = new h.body.geometry.constructor(), AH = new Float32Array(n * 4); for (let p = 0; p < n; p++) AH[p * 4] = RG.torso;
    g.setAttribute('position', new BA(bind, 3)); g.setAttribute('skinIndex', new h.body.geometry.attributes.skinIndex.constructor(G.SI, 4)); g.setAttribute('skinWeight', new BA(G.SW, 4)); g.setAttribute('aHero', new BA(AH, 4));
    const uv = new Float32Array(n * 2); g.setAttribute('uv', new BA(uv, 2)); g.setIndex(Array.from(W.tris)); g.computeVertexNormals();
    m = h._addCloth(g, { kind: 0, a: r.L.color || '#8a8478', b: r.L.color2 || r.L.color || '#8a8478', dirt: 0, part: 7, key: 'top', fab: r.fabric }); m.userData.stack = r.id; st.meshes.set(r.id, m); }
  else { m.geometry.attributes.position.array.set(bind); m.geometry.attributes.position.needsUpdate = true; m.geometry.index.array.set(W.tris); m.geometry.index.needsUpdate = true; m.geometry.computeVertexNormals(); }
  m.visible = true; return m;
}
