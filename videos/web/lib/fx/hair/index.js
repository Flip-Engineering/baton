// HAIR (HUMAN c8): hair, brows, lashes and beards, grown on a built hero from outside. ONE current version (8 Oct, the client: one current
// version of every module; superseded revisions live only in git history): the scalp hair is HAIR7's (round 7) on HAIR6's helical curls,
// settle and BSDF, HAIR5's colour model and part, HAIR4's Cycles-baked strand tiles and ropes. groomHero takes no revision.
//
//   import { loadHairStyles, groomHero } from '../lib/fx/hair/index.js';
//   const styles = await loadHairStyles();                         // assets/hair/styles/*.json (our own format, styles.js)
//   const g = groomHero(h, { styles, style: 'w_tail_low', form: 'wavy', age: 43, beard: 'none' });
//   // g.meshes are SkinnedMeshes bound to h.skeleton inside h.group; hero.js's hair, beard and tie shells are hidden;
//   // await hair4Ready() before a still (the baked strand tiles); the strands settle after the stance with sim6.js settleHair6(P)
//   g.report  -> counts and costs per part, build ms, hidden-under-hat clumps, the painted-brow status
//
// Options: style (name or object), form ('straight' | 'wavy' | 'curly' | 'coily'), melanin ({ eu, ph } or a hex; default the hero's
// o.hair hex), grey (0..1; default from age), age (years), brows (true | { thick, arch, lift, density }), lashes (true | { len }),
// beard ('none' | 'stubble' | 'short' | 'full' | 'moustache'; default from the hero's o.beard / o.stubble), beardForm, stubble (0..1),
// density, seed, hideShells (default true), keepHidden (keep clumps entirely under a hat; default false: they are never seen).
// No A/B switches (HAIR7 c7 it 1, 15 Oct: every built system ON): rope7, cohere7, the Cycles locks and follicles are the behaviour.
// o.cycles (true where makePerson builds the person for Cycles, its `export`): the fibres there grow from follicles, so the painted root
// base under the engine's cards is retired on that build's skin (the Cycles skin bake); the engine keeps it.
import * as THREE from 'three';
import { headField, sstep, mulberry, REG } from './field.js';
import { CardBuilder, hairlineFn } from './grow.js';
import { LAYER, FORMS, loadHairStyles, belowHat } from './styles.js';
import { growBrows, growLashes, growBeard, beardZone, browShape } from './face.js';
import { hairMaterial, hairDepthMaterials, melaninFromHex, hairAlbedo, greyByAge, patchSkin, skinUniforms, MELANIN, hairColour5, H6C } from './shade.js';
import { napePush, shortLayer, partOf, FORM5, REV5 } from './v5.js';
import { buildWrap } from './wraps.js';
import { hair6Key, FORM6M, CardBuilder6, REV6 } from './v6.js';
import './layers.js';
import { faceWindow } from './v3.js';
import { REV7, hairline7, part7, flow7, densWithPart7, sidePush7, layer7, shade7, rope7, drape7, sub7, fol7, boxOn, box7, gather7, plait7r, cohere7 } from './v7.js';

export { loadHairStyles, FORMS, MELANIN, melaninFromHex, hairAlbedo, greyByAge, headField };
export { hair4Ready, setAtlas4Data } from './atlas.js';   // (HAIR4)
export { hairColour5, sigma5 } from './shade.js';           // (HAIR5)

export function groomHero(h, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const F = headField(h), o = { seed: h.o.seed ?? 1, density: 1, hideShells: true, ...opts };
  const style = typeof o.style === 'string' ? o.styles?.[o.style] : o.style;
  if (o.style && !style) throw new Error('hair: unknown style ' + o.style);
  const rnd = mulberry(o.seed * 7717 + 13);
  // a light, unsaturated hex (Walt's '#9a948c') is grey hair, not blonde: dark-brown pigment with most strands white
  const hx = new THREE.Color(h.o.hair || '#2a1c12'), hsl = hx.getHSL({}, THREE.SRGBColorSpace), greyHex = !o.melanin && hsl.s < 0.15 && hsl.l > 0.4;
  const mel = o.melanin ? (typeof o.melanin === 'string' ? (MELANIN[o.melanin] || melaninFromHex(o.melanin)) : o.melanin) : greyHex ? { eu: 0.45, ph: 0.03 } : melaninFromHex(h.o.hair || '#2a1c12');
  const age = o.age ?? 20 + 50 * (h.o.age ?? 0.3), grey = o.grey ?? (greyHex ? Math.max(greyByAge(age), Math.min(0.92, 0.45 + (hsl.l - 0.4) * 1.4)) : greyByAge(age));
  const form = o.form || style?.form || 'straight';
  const meshes = [], report = { style: style?.name || null, form, melanin: mel, grey: +grey.toFixed(2), parts: {}, notes: [] };
  if (o.hideShells) { for (const m of [h.hairMesh, h.beardMesh, h.hairTie]) if (m) m.visible = false; }
  // temples and sides grey first (Panhard 2012); the crown and back last
  const greyBias = p => { const ph = Math.abs(Math.atan2(p.x - F.C.x, p.z - F.C.z)), ys = p.y - F.eyeY; return 0.9 * sstep(0.5, 1.0, ph) * sstep(2.3, 1.6, ph) * sstep(0.1, 0.02, ys) + 0.3 * sstep(0.1, 0.03, ys) - 0.35 * sstep(0.08, 0.13, ys); };
  report.rev = 7;   // (informational: the current hair is HAIR7's round-7 version)
  const depthM = hairDepthMaterials(), depthM3 = hairDepthMaterials(4);
  const mkMesh = (B, mat, part) => { const g = B.geometry(); if (!g.attributes.position.count) return null;
    const dm = part === 'scalp' ? depthM3 : depthM;
    const m = new THREE.SkinnedMesh(g, mat); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = dm.depth; m.customDistanceMaterial = dm.distance;
    if (g.morphAttributes.position) m.morphTargetInfluences = h.body.morphTargetInfluences;
    m.bind(h.skeleton, new THREE.Matrix4()); m.userData.subject = 1; m.userData.part = 'hair8'; m.userData.hairPart = part; h.group.add(m); meshes.push(m);
    report.parts[part] = { ...g.userData, bytes: Object.values(g.attributes).reduce((a, x) => a + x.array.byteLength, 0) + (g.index?.array.byteLength || 0) + (g.morphAttributes.position || []).reduce((a, x) => a + x.array.byteLength, 0) };
    return m; };

  // ---- wraps first: hair goes inside them (combined with any hat for the growth only; F.hat is restored after)
  const hat0 = F.hat; let wraps = [];
  if (style) for (const L of style.layers.filter(L => L.kind === 'wrap')) { const W = buildWrap(F, L, { seed: o.seed, rnd }); if (W) { wraps.push(W); for (const m of W.meshes) { h.group.add(m); meshes.push(m); } report.parts['wrap_' + (L.wrap || 'bandana')] = W.report; } }
  if (wraps.length) F.hat = combineVolumes(F, hat0, wraps.map(w => w.volume));
  // ---- scalp
  const stats = [];
  if (style) {
    const dens0 = hairlineFn(F, hairline7(style.hairline || {}, h.sex)), B = new CardBuilder6({ rnd: mulberry(o.seed * 9391 + 61), line: p => dens0.dist(p), geo6: { line: false, ...(o.geo6 || {}) } }), FB = new CardBuilder();
    const part5r = partOf(F, style, o.part === false ? false : { ...REV5.part, ...REV6.part, ...REV7.part, ...(o.part || {}) }), part5 = part7(part5r, F, o), dens = densWithPart7(dens0, part5);
    // o.look3 (the cast's flag, person/v2.js: L03 L05 L21 L17 L23): a style that is not one of the v3 styles keeps its strands out of the face
    // window (face3, styles.js scalp layer)
    const ctx = { F, B, FB, rnd, form, o, stats, greyBias, style, part5, flow7: flow7(part5), rope7: rope7(F, dens0, o), sub7: sub7(), box7: box7(F, dens0, o), boxG: { gather7, plait7r, sides: REV7.box.sides }, cohere7: (recs, push) => cohere7(F, recs, push, o), face3: o.look3 && !style.look3 ? faceWindow(F, {}) : null };
    // (HAIR5) a short layer's points pushed out of the skull and the neck alone where the full envelope would throw them sideways
    const push0 = F.push, nape5 = o.nape !== false ? napePush(F, push0, typeof o.nape === 'number' ? o.nape : REV5.cap) : null;
    const run = (fn, L, d) => { if (nape5 && shortLayer(L)) F.push = nape5; B.layer6 = L; if (SIDE7.includes(L.kind)) F.push = sidePush7(F, F.push, side7); try { fn(ctx, L, d); } finally { F.push = push0; } };
    // (HAIR7) the hair's volume beside the face (the body of the scalp hair; not ropes, buns, ties or the fine strands)
    const side7 = cm7(REV7.side.k[h.sex === 'f' ? 'f' : 'm']);
    // under a hat a bun or a tail that would sit in it is worn low at the nape, and the hair gathered to it follows
    let layers = style.layers;
    if (F.hat) { const moved = [];
      layers = layers.map(L => { if (!(L.kind === 'bun' || L.kind === 'tail' || L.kind === 'braid' || L.kind === 'puff') || !L.at) return L; const at = belowHat(F, L.at, L.kind === 'bun' ? 0.026 : L.kind === 'puff' ? 0.03 : 0.018); if (at[1] !== L.at[1]) moved.push([L.at, at]); return { ...L, at }; });
      const shift = v => { const m = moved.find(([a]) => Math.hypot(a[0] - v[0], a[1] - v[1], a[2] - v[2]) < 0.3); return m ? v.map((x, i) => x + m[1][i] - m[0][i]) : v; };
      if (moved.length) { layers = layers.map(L => L.gather?.to ? { ...L, gather: { ...L.gather, to: shift(L.gather.to) }, flow: L.flow?.to ? { ...L.flow, to: shift(L.flow.to) } : L.flow } : L); report.notes.push('tie moved below the hat rim'); } }
    layers = layers.map(L => layer7(L));
    for (const L of layers) { if (L.kind === 'wrap') continue; const fn = LAYER[L.kind]; if (!fn) { report.notes.push('unknown layer ' + L.kind); continue; } run(fn, L, dens); }
    // the hairline's fringe of fine strands (v3.js fringe3 -> fringe4): the combed styles, the textured ones, and the v3 manes
    const FR = { kind: 'fringe' };
    if (style.fringe !== false && o.fringe !== false && layers.some(L => L.kind === 'scalp' || L.kind === 'guides')) run(LAYER.fringe3, { ...FR, ...(style.fringe || {}), ...(o.fringe || {}) }, dens);
    else if (o.fringe !== false && layers.some(L => L.kind === 'afro' || L.kind === 'coils' || L.kind === 'braids' || L.kind === 'locs3')) run(LAYER.fringe3, { ...FR, ...(o.fringe || {}) }, dens);
    else if (style.fringe !== false && o.fringe !== false && style.look3 && layers.some(L => L.kind === 'mane')) run(LAYER.fringe3, { ...FR, ...(style.fringe || {}), ...(o.fringe || {}) }, dens);
    if (part5 && o.part5 !== false && !layers.some(L => L.kind === 'braids' || L.kind === 'locs3')) run(LAYER.part5, { kind: 'part5', ...REV6.part5, ...REV7.part5, ...(o.part5 || {}) }, dens0);   // (HAIR5: fine hairs along the part; HAIR6/7: a narrower, softer line, more hairs)
    if (!F.hat) run(LAYER.line7, { kind: 'line7' }, dens0);   // (HAIR7: the hairline as single fine strands)
    report.part5 = part5 ? { part: part5.part, halfCm: +(part5.hw * 100).toFixed(2) } : null;
    if (nape5) report.nape5 = { ...(F._nape5 || { caught: 0, calls: 0 }) }; if (F._nape5) F._nape5 = null;
    const mat = hairMaterial({ melanin: mel, grey, scalp: true, ...FORM5[form], form6: form, ...(FORM6M[form] || {}), ...shade7(mel, grey, form, FORM6M[form] || {}), ...(style.shade || {}), ...(o.shade || {}) });
    { const fol = fol7(F, dens0, part5, o); if (fol) mat.userData.shade = { ...mat.userData.shade, fol }; }   // (c3 iteration 2; every groom since c7 it 1: person_hair.py's follicles; its locks need no marker)
    if (boxOn(o) && ROPES7(style)) mat.userData.shade = { ...mat.userData.shade, box: 1 };   // (c4 it 1; the behaviour since c5 it 9: person_hair.py plaits a braid's fibres)
    const sm = mkMesh(B, mat, 'scalp');
    if (sm) { hair6Key(sm, mat); sm.userData.hold6 = Uint8Array.from(B.info6); }   // (HAIR6: which cards the physics leaves held)
    report.parts.scalp && (report.parts.scalp.layers = stats);
    if (report.parts.scalp) report.parts.scalp.geo6 = { ...B.st6 };   // (HAIR6: helical strips, tapered tips)
    // the skin under the hair: base, scalp stubble (buzz / shaved), beard stubble; and the painted brow off where card brows replace it
    applySkin(h, F, { dens, style, mel, o, report, greyBias, grey, part5 });
  } else applySkin(h, F, { dens: null, style: null, mel, o, report, greyBias, grey });
  F.hat = hat0;

  // ---- brows, lashes, beard (face cards: skinned to the face's own bones and carrying the expression morphs)
  const nM = (h.body.geometry.morphAttributes.position || []).length;
  const faceCard = (B, c, tile, extra = {}) => B.ribbon(c.pts, { tile, ua: extra.ua ?? 0, ub: extra.ub ?? 1, w0: c.w0, w1: c.w1, roll: extra.roll ?? 0, depth: c.depth ?? 0.3, rand: c.rand, grey: extra.grey ?? 0, C: F.C,
    out: extra.out || (() => c.sp.n), bend: extra.bend ?? 0.5, skin: () => [c.sp.si, c.sp.sw], morph: nM ? F.morphAt(c.sp) : null });
  if (o.brows !== false) { const BB = new CardBuilder({ morphs: nM }), br = growBrows(F, null, { sex: h.sex, seed: o.seed, age, ...(typeof o.brows === 'object' ? o.brows : {}) });
    for (const c of br.cards) { const ua = 0.45 * c.rand; faceCard(BB, c, 'brow', { ua, ub: ua + 0.5, out: () => c.sp.n, bend: 0.7 }); }
    const bm = { eu: mel.eu * 0.95 + 0.02, ph: mel.ph }; mkMesh(BB, hairMaterial({ melanin: bm, grey: grey * 0.55, alphaGain: 1.35, rootDark: 0.2, specR: 0.5, col5: true }), 'brows'); }
  if (o.lashes !== false) { const BL = new CardBuilder({ morphs: nM }), BLo = new CardBuilder({ morphs: nM }), ls = growLashes(F, { seed: o.seed, ...(typeof o.lashes === 'object' ? o.lashes : {}) });
    for (const c of ls) faceCard(c.upper ? BL : BLo, c, 'lash', { roll: 0, ua: c.ua, ub: c.ub, out: p => V3(0, c.upper ? 1 : -1, 0.35).normalize(), bend: 0.4 });
    const lm = { eu: Math.max(mel.eu * 1.5, 0.35), ph: mel.ph * 0.5 }; mkMesh(BL, hairMaterial({ melanin: lm, grey: grey * 0.12, alphaGain: 2.4, rootDark: 0.15, specR: 0.5, tt: 0.3, col5: true }), 'lashes');
    // the lower lashes: finer, shorter and fewer (Thibaut et al. 2010), and they read lighter than the upper row (thinner shafts,
    // seen against the lit cheek, no lid shadow behind them): their own mesh at a lower coverage gain and a lighter melanin
    mkMesh(BLo, hairMaterial({ melanin: { eu: lm.eu * 0.55, ph: lm.ph }, grey: grey * 0.2, alphaGain: 0.75, rootDark: 0.05, specR: 0.4, tt: 0.3, col5: true }), 'lashesLow'); }
  const beardKind = o.beard ?? (h.sex === 'f' ? 'none' : (h.o.beard ?? 0) > 0.4 ? 'full' : (h.o.beard ?? 0) > 0.15 ? 'short' : (h.o.stubble ?? 0) > 0.05 ? 'stubble' : 'none');
  report.beard = beardKind;
  if (beardKind !== 'none' && beardKind !== 'stubble') { const BD = new CardBuilder({ morphs: nM }), cards = growBeard(F, { kind: beardKind, form: o.beardForm || (form === 'coily' ? 'coily' : form === 'curly' ? 'curly' : 'straight'), seed: o.seed, len: o.beardLen, density: o.beardDensity, zone: { cheek: CHEEK[beardKind], ...(o.beardZone || {}) } });
    // the volume normal: the skin's own at the root, tipped a little toward the skull's radial (the skull-radial alone pointed the chin's
    // beard at the ground, and under a sky it went black)
    for (const c of cards) { const nb = c.sp.n.clone().multiplyScalar(0.75).add(c.sp.p.clone().sub(F.C).normalize().multiplyScalar(0.25)).normalize(); faceCard(BD, c, c.tile, { roll: (c.rand - 0.5) * 1.2, grey: greyBias(c.sp.p) * 0.5, bend: 0.6, out: () => nb }); }
    mkMesh(BD, hairMaterial({ melanin: { eu: mel.eu, ph: mel.ph * 1.25 + 0.02 }, grey: Math.min(0.95, grey * 1.15), alphaGain: 1.8, col5: true }), 'beard'); }

  report.ms = Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t0);
  report.verts = meshes.reduce((a, m) => a + (m.geometry.attributes.position?.count || 0), 0);
  report.tris = meshes.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count / 3 : 0), 0);
  report.paintedBrow = h.body.material.userData.hair8report || null;
  const G = { h, F, meshes, report, style, form, mel, grey, lod: 'cards', dens: style ? hairlineFn(F, style.hairline || {}) : null,
    drape7: drape7(form),   // (HAIR7: sim6.js settleHair6 hangs the length below the ears)
    setLOD(level) { if (level === this.lod) return this; this.lod = level; buildLOD(this); return this; },
    autoLOD(camera, H, px = 200) { const hp = headPixels(h, camera, H); this.setLOD(hp < px ? 'shell' : 'cards'); return hp; },
    dispose() { for (const m of meshes) { m.parent?.remove(m); m.geometry.dispose(); } if (this._shell) for (const m of this._shell) { m.parent?.remove(m); m.geometry.dispose(); } } };
  return G;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const cm7 = x => x / 100, SIDE7 = ['scalp', 'guides', 'mane', 'frame'];   // (HAIR7)
// the cheek line's height at the sideburn (cm above the eye centre) by beard: a full beard joins the sideburn, stubble sits lower
const CHEEK = { full: -1.0, short: -1.5, stubble: -2.0, moustache: -2.0 };

// the head's height on screen (px): the LOD rule
export function headPixels(h, camera, H) { h.update?.(); const a = h.joint('head'), top = a.clone().add(new THREE.Vector3(0, 0.22 * h.scale, 0)); const p = a.clone().project(camera), q = top.clone().project(camera); return Math.abs(q.y - p.y) * 0.5 * H; }

// ---------------------------------------------------------------- the skin under the hair
// a groom whose scalp hair is ropes (box braids, locs): box7 parts it
const ROPES7 = style => !!style?.layers?.some(L => L.kind === 'braids' || L.kind === 'locs3');
function applySkin(h, F, { dens, style, mel, o, report, greyBias, grey = 0, part5 = null }) {
  const albOf = (eu, ph) => hairColour5(eu, ph).albedo;   // (HAIR5: the scalp base, brow base and beard zone in the one colour model)
  const g = h.body.geometry, P = g.attributes.position.array, n = h.meta.n, AH = h.aHero, A = new Float32Array(n * 4);
  const fem = h.sex === 'f', beardKind = o.beard ?? null, BZ = { cheek: CHEEK[beardKind] ?? CHEEK.stubble, ...(o.beardZone || {}), ...(beardKind === 'moustache' ? { sides: 0, chin: 0 } : {}) }, bz = beardZone(F, BZ);
  const stub = o.stubble ?? (fem ? 0 : h.o.stubble ?? 0.5);
  const p = new THREE.Vector3();
  // x: the scalp's density away from the hairline (thinning, crown, a fringe band; the line itself is drawn per pixel, shade.js)
  for (let v = 0; v < n; v++) { const r = AH[v * 4]; if (r !== REG.head && r !== REG.jaw && r !== REG.neck) continue; p.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    if (dens && (r === REG.head || r === REG.neck) && !(F.EAR[F.cellOf(p.x - F.C.x, p.y - F.C.y, p.z - F.C.z)] && p.y < F.earTop - 0.004)) A[v * 4] = dens.extra(p);
    A[v * 4 + 1] = bz(p); }
  g.setAttribute('aHairD', new THREE.BufferAttribute(A, 4));
  const alb = albOf(mel.eu, mel.ph);
  const bk = 0.9 * H6C.gain,   /* (HAIR6: the base under the person-calibrated body colour) */ base = new THREE.Color(alb[0] * bk, alb[1] * bk, alb[2] * bk);   // (HAIR5: the base is the hair's own body colour; under blonde hair the 0.36 root shadow read as a dark patch)
  // (HAIR4) under grey and white hair the scalp is seen through unpigmented strands, not a dark root shadow (the dark base under white
  // cards read as a crust): the base's strength falls with the grey fraction (set on U below)
  const hasBeardCards = beardKind && beardKind !== 'none' && beardKind !== 'stubble';
  // the painted brow (hero.js) goes off where card brows replace it; the cards get their own soft base on the skin (hzBr*)
  const cardBrows = o.brows !== false;
  // (HAIR7 c3 iteration 3; c7 it 1: follicles are every groom's) the painted root base is retired where every fibre leaves the skin from its
  // own follicle (person_hair.py FOL), i.e. on a build for Cycles (o.cycles): the scalp is skin, darkened by the fibres' shadow and roots,
  // not by paint. The engine's cards are not fibres and keep it.
  // (c4 iteration 1; the behaviour since c5 it 9) a rope groom parted into boxes carries each box's own hair on the skin: the painted base goes (the
  // partings show the scalp), in the engine and the Cycles skin bake alike
  const U = skinUniforms({ baseK: o.cycles || (boxOn(o) && ROPES7(style)) ? 0 : (style?.base ?? (dens ? 0.85 : 0)) * (1 - 0.75 * Math.min(1, grey)), stub: fem ? 0 : hasBeardCards ? 1 : stub, shave: style?.shave ?? 0, brow: cardBrows ? 0 : 1 });
  U.hzBase.value.copy(base); U.hzC.value.set(F.C.x, F.C.y, F.C.z, F.eyeY);
  const base7 = REV7.base;   // (HAIR7: the painted root base starts inside the line, under the fine strands)
  U.hzPart = { value: new THREE.Vector4(part5 ? part5.m.x : 1, part5 ? part5.m.z : 0, part5 ? part5.hw : 0.001, part5 ? part5.strength : 0) }; U.hzPart2 = { value: new THREE.Vector4(F.ry, F.rz, base7.ramp / 100, 0) };   // (HAIR5: the part line of skin; the root base's ramp at the hairline)
  // (HAIR7 c3 iteration 2; every groom since c7 it 1) the painted part line on the SAME jag as the roots (part7): amplitude, the two wavelengths, phases
  const jg = part5?.jagP ? part5.jagP : null; U.hzPart3 = { value: new THREE.Vector4(jg ? jg[0] : 0, jg ? jg[1] : 1, jg ? jg[2] : 1, jg ? jg[3] : 0) }; if (jg) U.hzPart2.value.w = jg[4];
  if (dens) { dens.knots.forEach((k, i) => U.hzKn.value[i].set(k[0], k[1] + base7.inset / 100, k[2] ?? 0)); U.hzSoft.value = Math.max(dens.soft, 0.007); }   // (HAIR4: the base ramps over a wider band under fringe4)
  if (cardBrows) { const bo = typeof o.brows === 'object' ? o.brows : {}, S = browShape(F, { sex: h.sex, seed: o.seed, ...bo });
    for (let k = 0; k < 9; k++) { const u = k / 8, c = S.centre(u); U.hzBr.value[k].set(c.x, c.y - F.eyeY, S.thick(u)); }
    const ba = albOf(mel.eu * 0.95 + 0.02, mel.ph); U.hzBrC.value.setRGB(ba[0] * 0.6, ba[1] * 0.6, ba[2] * 0.6);
    U.hzBrK.value.set((fem ? 0.3 : 0.38) * (bo.base ?? 1) * Math.min(1.2, bo.density ?? 1), F.eL.z - 0.03, 0, 0); }
  // the beard zone per pixel (shade.js hzBeard: the same cheek line, neckline, lips and moustache as face.js beardZone) and the colour
  // of the shafts in it: the beard's own albedo with its grey, a little darker (stubble and the base under beard cards)
  const sf = (BZ.soft ?? 0.35) / 100;
  U.hzBz0.value.set(F.mouth.y, F.mouth.z, F.hc.z, F.eL.z); U.hzBz1.value.set(F.chinY, (BZ.cheek ?? -2.4) / 100, (BZ.neck ?? 3.0) / 100, sf); U.hzBz2.value.set(F.earF, BZ.moustache ?? 1, BZ.chin ?? 1, BZ.sides ?? 1);
  { const bg = Math.min(0.95, grey * 1.15), ba = albOf(mel.eu, mel.ph * 1.25 + 0.02), gw = [0.52, 0.47, 0.41]; U.hzBdC.value.setRGB(...ba.map((x, i) => (x * (1 - bg) + gw[i] * bg) * 0.6)); }
  patchSkin(h, U);
  if (h.skinU.hBrow) h.skinU.hBrow.value = cardBrows ? 0 : 1;          // hero.js's H2 hook (HOOKS pass): its painted brow off under card brows, soft lid ends; shade.js then leaves its text alone
  h.skinU.hStubble.value = 0;                                       // hero.js's jaw shadow: replaced by the follicle stubble
  report.skin = { base: +(style?.base ?? 0).toFixed(2), stubble: +U.hzK.value.y.toFixed(2), shave: +U.hzK.value.w.toFixed(2) };
}

// ---------------------------------------------------------------- hats and wraps together
function combineVolumes(F, hat, vols) {
  const list = [hat, ...vols].filter(Boolean);
  return { kind: 'combined', topY: Math.max(...list.map(v => v.topY)), clamp(p, m) { let moved = false; for (const v of list) moved = v.clamp(p, m) || moved; return moved; },
    rimAt(ph) { return Math.min(...list.map(v => v.rimAt(ph))); } };
}

// ---------------------------------------------------------------- LOD: under ~200 px a shell and a fringe of silhouette cards
// The shell is the scalp's own faces (density > 0.3) pushed out to the hair's measured volume (the mean radius of the grown cards over
// each skin vertex's cube cell), shaded by the same hair material with full coverage; the fringe is every third outer-layer card.
function buildLOD(G) {
  const { h, F, meshes } = G, scalp = meshes.find(m => m.userData.hairPart === 'scalp'); if (!scalp) return;
  if (!G._shell) {
    const pos = scalp.geometry.attributes.position.array, aux = scalp.geometry.attributes.aHair.array, NC = F.R.length, sum = new Float32Array(NC), cnt = new Uint16Array(NC);
    // (HAIR6: under rev 6 only the hair within 4 cm of the scalp counts, the offset capped at 2.5 cm: settled long hair hanging past the
    // shoulders and the helical strips pushed the first rev-6 shells out into fins and wings)
    const near6 = 0.04;
    for (let i = 0; i < pos.length / 3; i++) { const dx = pos[i * 3] - F.C.x, dy = pos[i * 3 + 1] - F.C.y, dz = pos[i * 3 + 2] - F.C.z, ci = F.cellOf(dx, dy, dz), l = Math.hypot(dx, dy, dz); if (F.R[ci] <= 0 || l - F.R[ci] > near6) continue; sum[ci] += l - F.R[ci]; cnt[ci]++; }
    for (let c = 0; c < NC; c++) if (cnt[c]) sum[c] = Math.min(sum[c], 0.025 * cnt[c]);
    const g = h.body.geometry, P = g.attributes.position.array, IDX = g.index.array, AHD = g.attributes.aHairD?.array, NR = h.nrm;
    // the shell is the haired scalp only: the style's hairline (G.dens, per vertex here: at <200 px a vertex is under a pixel) times the
    // scalp density; aHairD.x alone is 1 over the whole head and the first shell covered the face
    const dens = G.dens, hv = new Float32Array(P.length / 3).fill(-1), pv = new THREE.Vector3();
    const keep = v => { if (!AHD || !dens) return false; if (hv[v] < 0) { pv.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); hv[v] = AHD[v * 4] * dens(pv); } return hv[v] > 0.45; };
    const B = new CardBuilder(), map = new Map(), faces = [];
    for (let t = 0; t < IDX.length; t += 3) if (keep(IDX[t]) && keep(IDX[t + 1]) && keep(IDX[t + 2])) faces.push(IDX[t], IDX[t + 1], IDX[t + 2]);
    const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array;
    for (const v of new Set(faces)) { const dx = P[v * 3] - F.C.x, dy = P[v * 3 + 1] - F.C.y, dz = P[v * 3 + 2] - F.C.z, ci = F.cellOf(dx, dy, dz), off = cnt[ci] ? Math.max(0.002, sum[ci] / cnt[ci]) : 0.003;
      const nn = V3(NR[v * 3], NR[v * 3 + 1], NR[v * 3 + 2]), pp = V3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).addScaledVector(nn, off);
      const tan = V3(0, -1, -0.3).addScaledVector(nn, -nn.dot(V3(0, -1, -0.3))).normalize();
      map.set(v, B.count); B._v(pp, nn, 0.88 + 0.06 * ((v * 7) % 10) / 10, (pp.y - F.eyeY) * 6, tan, [0.6, 0.5, 0.5, 0], [SI[v * 4], SI[v * 4 + 1], SI[v * 4 + 2], SI[v * 4 + 3]], [SW[v * 4], SW[v * 4 + 1], SW[v * 4 + 2], SW[v * 4 + 3]]); }
    for (const v of faces) B.IX.push(map.get(v));
    const mat = scalp.material.clone(); mat.onBeforeCompile = scalp.material.onBeforeCompile; mat.customProgramCacheKey = scalp.material.customProgramCacheKey;
    const U0 = scalp.material.userData.hairU, U = { ...U0, hMisc: { value: U0.hMisc.value.clone().setX(6) }, ...(U0.h4T ? { h4T: { value: U0.h4T.value.clone().setY(6).setX(0.001) } } : {}) };
    mat.onBeforeCompile = sh => { scalp.material.onBeforeCompile(sh); Object.assign(sh.uniforms, U); };
    const shell = new THREE.SkinnedMesh(B.geometry(), mat); shell.frustumCulled = false; shell.castShadow = shell.receiveShadow = true; shell.bind(h.skeleton, new THREE.Matrix4()); shell.userData.subject = 1; shell.userData.hairPart = 'shell';
    // the fringe: every third card whose depth is outer (aHair.y == 0), copied from the scalp geometry by its index ranges
    const sg = scalp.geometry, idx = sg.index.array, keepTri = [];
    const strip6 = a => { const r = aux[a * 4 + 2] * 16; return Math.floor(r) === 0 && r - Math.floor(r) >= 0.9; };   // (HAIR6: one in twelve of rev 6's helical curl strips in the distance fringe, not one in three)
    // (HAIR6: under rev 6 the hanging lengths too: the shell is the scalp's, and long hair, ropes and braids beyond it had only the outer
    // layer's every third card: at 270 px L08's curls and L14's braids vanished. Past 30 % of a card's length every layer joins, one card in
    // three (ropes and the strips one in twelve))
    const hang6 = a => aux[a * 4] > 0.3 && aux[a * 4 + 1] < 1.01;
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t]; if ((aux[a * 4 + 1] < 0.01 || (hang6 && hang6(a))) && (strip6 && strip6(a) ? Math.floor(aux[a * 4 + 2] * 16000) % 12 : Math.floor(aux[a * 4 + 2] * 1000) % 3) === 0) keepTri.push(idx[t], idx[t + 1], idx[t + 2]); }
    const fg = sg.clone(); fg.setIndex(keepTri); const fringe = new THREE.SkinnedMesh(fg, scalp.material); fringe.frustumCulled = false; fringe.castShadow = true; fringe.receiveShadow = true; fringe.customDepthMaterial = scalp.customDepthMaterial; fringe.bind(h.skeleton, new THREE.Matrix4()); fringe.userData.subject = 1; fringe.userData.hairPart = 'fringe';
    shell.onBeforeRender = scalp.onBeforeRender; fringe.onBeforeRender = scalp.onBeforeRender;   // (HAIR6: the key's depth span for the deep opacity)
    h.group.add(shell); h.group.add(fringe); G._shell = [shell, fringe];
    G.report.lod = { shellTris: B.IX.length / 3, fringeTris: keepTri.length / 3 };
  }
  const shellOn = G.lod === 'shell';
  for (const m of G._shell) m.visible = shellOn; scalp.visible = !shellOn;
  for (const m of meshes) if (m.userData.hairPart === 'lashes' || m.userData.hairPart === 'lashesLow') m.visible = !shellOn;    // lashes under 200 px are below a pixel
}

// ---------------------------------------------------------------- CREW8: each person's own hair (a mapping, not a default)
// age from the spec's range; the hair form and style chosen for the person (the women's critic 4.5: working hair, tied, pinned or
// covered at work); beards from the spec (Otis and Ray: a short beard and heavy stubble, no longer a balaclava shell)
export const CREW_HAIR = {
  Ada: { style: 'w_bun_low', form: 'coily' }, Walt: { style: 'm_sidepart', form: 'straight', beard: 'full', beardLen: 0.55 }, Rosa: { style: 'w_tail_low', form: 'wavy', grey: 0.08 },
  Otis: { style: 'm_crop', form: 'coily', beard: 'short', grey: 0.18 }, Kai: { style: 'm_crop', form: 'straight', beard: 'stubble', stubble: 0.3 }, June: { style: 'w_crop', form: 'wavy' },
  Ray: { style: 'm_crop', form: 'curly', beard: 'stubble', stubble: 1 }, Mei: { style: 'w_tail_low', form: 'straight' },
};
export function crewHair(spec) { const a = spec.age ? (spec.age[0] + spec.age[1]) / 2 : 35; return { age: a, ...(CREW_HAIR[spec.name] || { style: spec.sex === 'f' ? 'w_bun_low' : 'm_crop' }) }; }
