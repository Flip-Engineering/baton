// ANAT8-HEAD (it3, 8 Oct): the MUSCLES of expression and mastication as VOLUMES on our skull, each with its origin and insertion, line of
// action and rest length (for FACS action units later: a unit is a contraction of named muscles along their lines; no expression is built
// here). Two kinds: SHELLS that lie on the bone (frontalis, procerus, temporalis, masseter, orbicularis oculi: the solid between gap and
// gap + T mm off the bone, cut to the muscle's outline: they follow the bone's own surface and bridge what is narrower than they are
// thick), STRAPS (sweeps from an origin on the bone, lifted off it as they cross the deep fat, to an insertion in the lips, the modiolus or
// the skin: zygomatici, levators, risorius, depressors, mentalis, corrugator) and SHEETS (buccinator, platysma), the orbicularis oris a
// pair of arcs round the mouth. THICKNESS (mm, at 30 years, BMI 24) is FACE6's (body/face_tissue.js LAYERS: masseter Raadsheer et al.
// 1996 by ultrasound at rest, women 10 / men 12; temporalis 5 / 6; orbicularis oculi 1.0 / 1.2; orbicularis oris 5 / 6; zygomaticus
// 2.2 / 2.6; levator 1.8 / 2.0; buccinator 3 / 3.5; mentalis 4 / 5; frontalis 1.2 / 1.4) with their age terms (a fraction a decade from
// 30); the rest as recalled from anatomy texts (procerus, corrugator, risorius, the depressors, platysma: provisional). FITNESS (0..1, 0.5
// default) scales the muscles of mastication +-15 % (they hypertrophy with use: Raadsheer 1996, as recalled).
// Built on the person's LEFT (+x) and mirrored. Every number in mm, the craniometric frame (skull/frame.js).
import * as D from '../layer/sdf.js';
import { v3, clamp, lerp, sstep, LBL, onBone, hitBone, shell, prism, boxOf, mirrorBox, f1, f2, r1 } from './common.js';
export const MUSCLES_VERSION = 5;   // (lane it24, the orchestrator's probe of 16 Oct landed as the behaviour) THE MASSETER'S ANTERIOR PART AS A SHEET from the arch's lower border to its insertion, in front of the ramus only (the o.masseterSheet switch deleted: git history). (4, it13) the masseter's insertion fleshy at the angle and lower border, the sling's lateral half. (3, it9) the masseter inserts along the mandible's lower border to the antegonial notch. (was 2: the anterior digastric bellies, it6)
// thickness (mm) by sex at 30 / BMI 24, age (fraction a decade from 30), group, source
export const MUSCLE_T = {
  temporalis: { f: 5, m: 6, age: -0.08, mast: true, src: 'FACE6 (temporal hollowing with age), as recalled' },
  masseter: { f: 10, m: 12, age: -0.04, mast: true, src: 'Raadsheer et al. 1996 (ultrasound, rest), as recalled' },
  frontalis: { f: 1.2, m: 1.4, age: -0.03, src: 'FACE6' }, procerus: { f: 1.6, m: 1.9, age: -0.02, src: 'as recalled' },
  corrugator: { f: 2.0, m: 2.4, age: -0.02, src: 'as recalled' }, orbOculi: { f: 1.0, m: 1.2, age: -0.03, src: 'FACE6 (pars orbitalis)' },
  orbOculiPalp: { f: 0.45, m: 0.5, age: -0.03, src: 'as recalled (pars palpebralis)' },
  llsan: { f: 1.5, m: 1.7, age: -0.03, src: 'as recalled' }, lls: { f: 1.8, m: 2.0, age: -0.03, src: 'FACE6 (levator)' },
  zygMinor: { f: 1.5, m: 1.7, age: -0.03, src: 'as recalled' }, zygMajor: { f: 2.2, m: 2.6, age: -0.03, src: 'FACE6' },
  risorius: { f: 1.0, m: 1.2, age: -0.03, src: 'as recalled (variable)' }, buccinator: { f: 3, m: 3.5, age: -0.03, src: 'FACE6' },
  orbOris: { f: 5, m: 6, age: -0.08, src: 'FACE6 (the lips thin with age: Iblher 2008, Penna 2009, direction)' },
  dao: { f: 1.8, m: 2.0, age: -0.03, src: 'as recalled' }, dli: { f: 1.6, m: 1.8, age: -0.03, src: 'as recalled' },
  mentalis: { f: 4, m: 5, age: -0.04, src: 'FACE6' }, platysma: { f: 1.0, m: 1.2, age: -0.03, src: 'as recalled' },
  digastricAnt: { f: 5, m: 6, age: -0.03, src: 'anterior belly of the digastric ~8-10 mm wide, 5-6 mm thick (anatomy texts, as recalled)' },
};
export function muscleT(key, st) { const M = MUSCLE_T[key], sex = st.sex === 'm' ? 'm' : 'f', dec = Math.max(0, (st.age ?? 35) - 30) / 10, young = Math.max(0, 30 - (st.age ?? 35)) / 10;
  const ageK = Math.max(0.5, 1 + M.age * dec - 0.5 * M.age * young), fitK = M.mast ? 0.85 + 0.3 * clamp(st.fitness ?? 0.5, 0, 1) : 1; return M[sex] * ageK * fitK; }

// buildMuscles(B, G, soft, st) -> { list: [{ key, name, kind, side, T, origin, insertion, line, rest, prim }], prims (left and right),
// report }. B: the skull (skull.js buildSkull: B.geo, B.lm, B.arch, B.globe, B.K); G: the bone's sampled field; soft: the soft anchors
// (head/index.js softAnchors: sto, mod, lipFront(x, y), toothFront(x, y), chX); st: { sex, age, bmi, fitness }
export function buildMuscles(B, G, soft, st, o = {}) {   // (c6 it16) the A/B switches o.masseterBorder / o.masseterBelly DELETED (git history only)
  const g = B.geo, lm = B.lm, K = B.K, list = [], m = st.sex === 'm', T = k => muscleT(k, st); let masBorder = null;
  const add = (key, name, kind, prim, origin, insertion, extra = {}) => { const line = v3.norm(v3.sub(origin, insertion)), rest = v3.dist(origin, insertion);
    list.push({ key, name, kind, side: 'L', T: f2(T(MUSCLE_T[key] ? key : 'frontalis')), origin: r1(origin), insertion: r1(insertion), line: line.map(f2), rest: f1(rest), prim: { ...prim, label: LBL.muscle, name }, ...extra }); };
  const surfZ = (x, y, z0 = 200) => { const h = hitBone(G, [x, y, z0], [0, 0, -1], 260); return h ? h[2] : null; };
  const surfX = (y, z, x0 = 120) => { const h = hitBone(G, [x0, y, z], [-1, 0, 0], 140); return h ? h[0] : null; };
  const bonePt = (x, y, lift, z0) => onBone(G, [x, y, surfZ(x, y, z0) ?? g.zN], lift);
  const strap = (pts, secs, up = [0, 1, 0], sub = 4) => D.sweep(pts, secs, { up, sub });
  // ---- TEMPORALIS: a shell in the temporal fossa (thin at the superior temporal line, thickest just above the arch), its deep part a
  // tendon passing inside the arch to the coronoid's tip and down the ramus' anterior border
  { const Tt = T('temporalis'), xArch = K.ZYB / 2 - 5.5, yArchTop = -6.8 + g.aH + 1, xMin = K.WFB / 2 - 14;
    const mask = p => { const [x, y, z] = p, r = g.fossaRegion(y, z) + 1.5, inner = xMin - x, under = (-11 - y), arch = x - xArch - 4 * Math.max(0, y - (yArchTop + 2)); return Math.max(r, inner, under, arch); };
    const Tf = p => { const d = -g.fossaRegion(p[1], p[2]); return Tt * sstep(0, 16, d) * lerp(1.6, 1, sstep(0, 30, p[1])); };
    const box = [xMin - 2, -14, -40, K.ZYB / 2 + 2, g.yN + 56, g.zFMA + 4];
    const sh = shell(G, Tf, 0.3, mask, box, { name: 'temporalis' });
    const cor = lm.Cor_L, top = [K.WFB / 2 + 4, -3, g.zFMA - 22], mid = [(top[0] + cor[0]) / 2 + 2, cor[1] + 7, cor[2] - 4], low = [cor[0] + 1.5, cor[1] - 13, cor[2] + 0.5];
    const ten = strap([top, mid, cor, low], [{ a: 10, b: 0.5 * Tt + 1.5 }, { a: 7.5, b: 0.45 * Tt + 1 }, { a: 4, b: 2.2 }, { a: 3, b: 1.6 }], [0, 0, 1]);
    const tS = D.scene([], 'temporalis').add(sh).add(ten, 3);
    add('temporalis', 'temporalis', 'shell', tS, [K.WFB / 2 + 6, g.yN + 30, g.zFMA - 30], cor, { fossa: true }); }
  // ---- MASSETER: a shell over the ramus and the angle hanging from the arch's lower border (superficial and deep heads as one volume)
  // (it9, MUSCLES_VERSION 3) THE INSERTION ALONG THE LOWER BORDER: the superficial head inserts on the angle and the lower half of the
  // ramus' lateral surface, and its anterior border descends to the mandible's lower border at the antegonial notch (where the facial
  // artery crosses it). it3-it8's outline put its lower edge at the GONION's height all the way forward (lowB + 4 at Go + 30): right only
  // for a level mandibular plane; on our mandibles (FMA ~30 deg) the border in front of the angle falls 7-18 mm below that by Go + 20..30
  // (L08 -57.9 / -61.4 / -64.9 at Go + 20 / 25 / 30 against an edge at -50.9 / -48.9 / -46.9; L21 -67.5 / -69.5 / -72.5 against -62 / -60
  // / -58), so the lower ramus and the body behind the notch carried a 1.2 mm film where the masseter's lower belly lies. The lower edge
  // now FOLLOWS OUR MANDIBLE's lower border (sampled from B.parts.mandible), the notch kept where it3 put it (Go + 30).
  { const Tm = T('masseter'), Go = lm.Go_L, archBot = -6.8 - g.aH - 0.6, zA = g.Mal[2] - 14, zP = g.zTub + 3, lowB = Go[1] + 2;
    const mand = B.parts?.mandible, border = z => { if (!mand) return null; for (let y = Go[1] - 40; y <= Go[1] + 12; y += 0.5) { for (let x = 12; x <= K.ZYB / 2 + 6; x += 0.75) if (mand.d(x, y, z) < 0) { let xl = x; for (let x2 = K.ZYB / 2 + 6; x2 > x; x2 -= 0.5) if (mand.d(x2, y + 3, z) < 0) { xl = x2; break; } return { y, x: xl }; } } return null; };
    const bAt = dz => { const b = border(Go[2] + dz); return b ? b.y - 0.5 : lowB - 3; }, bx = [10, 20, 25, 30].map(dz => ({ dz, b: border(Go[2] + dz) }));
    const poly = [[archBot + 1.5, zP], [archBot + 0.5, (zP + zA) / 2], [archBot + 1, zA], [g.Mal[1] - 9, zA - 1], [bAt(30), Go[2] + 30], [bAt(25), Go[2] + 25], [bAt(20), Go[2] + 20], [Math.min(lowB - 3, bAt(12)), Go[2] + 12], [lowB - 2.5, Go[2] - 1.5], [(lowB + archBot) / 2, zP - 4]];
    // the medial limit (not onto the ramus' inner face): it3's plane, let down to 3 mm inside the body's LATERAL surface (3 mm above the
    // border) where the body converges forward (else the plane cut the belly off the body)
    const xb = bx.filter(q => q.b), xMin0 = K.goGo / 2 - 14, xMinAt = z => { if (!xb.length) return xMin0; const dz = z - Go[2]; let q = xb[0]; for (const r of xb) if (Math.abs(r.dz - dz) < Math.abs(q.dz - dz)) q = r; return Math.min(xMin0, q.b.x - 3); };
    // (it13, MUSCLES_VERSION 4) THE INSERTION IS FLESHY: the superficial head's lower fibres end on the angle and the lower border at
    // the belly's full thickness (the masseteric tuberosities; Raadsheer's thickness is read over the lower third, the thickest part),
    // and with the medial pterygoid on the inner face they make the pterygomasseteric SLING that wraps the angle. it3-it12 tapered the
    // shell to 0.4 T at EVERY edge of its outline, the insertion included, and cut it at the border: over the angle the bone carried
    // ~5 mm of muscle (gonion's depth 6.7 / 8.3 mm on L21 / L23 against the tables' 14.6 / 16.4, the jaw line 3-5 mm inside the scans).
    // Now the taper belongs to the ORIGIN (the arch) and the free ANTERIOR and POSTERIOR borders only, and the belly runs over the border
    // by half its thickness (the sling's lateral half; the medial half lies inside the ramus' plane and adds nothing to the skin).
    const belly = true, wrap = 0.5 * Tm;
    const INS = [5, 6, 7, 8], polyM = poly.map((q, i) => INS.includes(i) ? [q[0] - wrap, q[1] - (i === 8 ? wrap : 0)] : q);
    const polyT = poly.map((q, i) => INS.includes(i) ? [q[0] - 14, q[1] - (i === 8 ? 10 : 0)] : q);
    const R = D.regionPoly(polyM), RT = D.regionPoly(polyT), xMin = Math.min(xMin0, ...xb.map(q => q.b.x - 3));
    const mask = p => Math.max(R(p[1], p[2]), xMinAt(p[2]) - p[0]);
    border.report = { belly, wrap: f1(wrap), lowerBorder: bx.map(q => ({ dz: q.dz, y: q.b ? f1(q.b.y) : null, x: q.b ? f1(q.b.x) : null })), edgeWas: [f1(lowB + 4), 'at Go + 30'] }; masBorder = border.report;
    const Tf = p => { const d = -RT(p[1], p[2]); return Tm * (0.4 + 0.6 * sstep(0, 9, d)); };
    const box = [xMin - 2, Math.min(lowB - 6 - wrap, ...polyM.map(q => q[0] - 4)), Go[2] - 8 - wrap, K.ZYB / 2 + 16, archBot + 4, zA + 6];
    let sh = shell(G, Tf, 0.3, mask, box, { name: 'masseter' });
    // (orchestrator 16 Oct; MUSCLES_VERSION 5, lane it24: the behaviour, its switch deleted) THE MUSCLE RUNS FROM ITS ORIGIN TO ITS INSERTION, NOT ON WHATEVER BONE LIES UNDER
    // IT. The shell above is the band 0.3 .. 0.3 + T off the NEAREST bone inside the outline; in front of the ramus' anterior border (the
    // outline's anterior third, from the arch at zA down to the antegonial notch) the nearest bone is the maxilla's lateral wall 15-20 mm
    // medial, so the band there was empty or lay on the maxilla and the cheek in front of the masseter fell away (the envelope dropped
    // 20 mm at |x| ~46 at the mouth's height on L08, where the HSRD-100 heads' cheek runs on to |x| ~56). The superficial masseter is a
    // sheet from the zygomatic arch's lower border to the mandible's lateral surface along its lower border and the angle, its anterior
    // fibres passing over the buccal fat pad and the buccinator (Gray's Anatomy; Standring 2016, the masseter's attachments). So: the
    // SHEET (at depth z, the straight line in y from the arch's lateral surface just under its border to the insertion on the lower border,
    // the notch for the fibres ahead of it) carries a band of the same thickness, united with the shell (over the ramus they coincide).
    // Probed (the orchestrator, orchE; lane it24 on L12): L08's front half-width 80 mm under the eye line 33 -> 44.4 mm (the HSRD-100 women
    // 45.7), the mid-ramus depth unchanged; the solved amounts move with it (L08's middle cheek k 1 -> 0.5).
    {
      const z0 = Math.floor(Go[2] - 12), z1 = Math.ceil(zA + 8), zs = [], xTop = [], ins = [];
      const notch = border(Go[2] + 30) || { x: K.goGo / 2, y: lowB - 3 };
      for (let z = z0; z <= z1; z += 2) { zs.push(z); xTop.push((surfX(archBot + 1.5, z) ?? (K.ZYB / 2 - 5)) - 1.5); const b = z <= Go[2] + 30 ? (border(z) || notch) : notch; ins.push([b.x, b.y + 1]); }
      const at = (arr, z) => { const f = clamp((z - z0) / 2, 0, zs.length - 1), i = Math.min(zs.length - 2, Math.floor(f)), t = f - i; return Array.isArray(arr[i]) ? [lerp(arr[i][0], arr[i + 1][0], t), lerp(arr[i][1], arr[i + 1][1], t)] : lerp(arr[i], arr[i + 1], t); };
      const sheetX = (y, z) => { const xt = at(xTop, z), [xb, yb] = at(ins, z), t = clamp((archBot - y) / Math.max(4, archBot - yb), 0, 1); return lerp(xt, xb, t); };
      // only IN FRONT OF THE RAMUS (its anterior border ~ RB ahead of the angle): over the ramus the belly lies on the bone (the shell),
      // and a sheet there would float it off the ramus (a first probe: the mid-ramus depth 22.5 mm against the table's 17.5)
      const zRam = Go[2] + K.RB - 3;
      const band = D.custom((x, y, z) => { const p = [x, y, z], t = Tf(p), xs = sheetX(y, z) + 0.3; return D.smax(D.smax(Math.abs(x - (xs + t / 2)) - t / 2, mask(p), 1.5), zRam - z, 2); }, box, { name: 'masseter sheet' });
      sh = D.scene([], 'masseter').add(sh).add(band, 1.5);
      masBorder.sheet = { xTop: [f1(xTop[0]), f1(xTop[xTop.length - 1])], notch: [f1(notch.x), f1(notch.y)], zRange: [z0, z1] }; }
    add('masseter', 'masseter', 'shell', sh, [K.ZYB / 2 - 4, archBot, (zA + zP) / 2], [Go[0] + 2, Go[1] + 8, Go[2] + 10]); }
  // ---- FRONTALIS: a thin shell over the frontal bone from the brows to the galea (two bellies, apart at the midline above the lower
  // forehead), fading into the galea aponeurotica at the hairline
  { const Tf0 = T('frontalis'), y0 = g.ySupM + 2.5, yTop = g.yN + 72;
    const poly = [[-0.5, y0], [g.xOc, g.ySupM + 1], [g.xEc - 1, g.ySupM + 5], [g.xTL(g.yN + 40) - 3, g.yN + 40], [g.xTL(g.yN + 66) - 6, g.yN + 66], [16, yTop], [5, g.yN + 48], [-0.5, g.yN + 32]];
    const R = D.regionPoly(poly), mask = p => Math.max(R(p[0], p[1]), g.zN - 40 - p[2]);
    const Tf = p => Tf0 * sstep(0, 5, -R(p[0], p[1])) * (1 - 0.7 * sstep(g.yN + 50, yTop, p[1]));
    const sh = shell(G, Tf, 0.6, mask, [-2, y0 - 4, g.zN - 44, g.xEc + 6, yTop + 4, g.zG + 6], { name: 'frontalis' });
    add('frontalis', 'frontalis', 'shell', sh, [18, g.yN + 66, surfZ(18, g.yN + 66) ?? g.zN], [g.xOc - 4, g.ySupM + 4, g.zSup + 4]); }
  // ---- PROCERUS: a slip on the nasal bones up to the glabella's skin
  { const Tp = T('procerus'), R = D.regionPoly([[-0.5, g.yN - 13], [6, g.yN - 12], [7, g.yG + 3], [-0.5, g.yG + 6]]), mask = p => Math.max(R(p[0], p[1]), g.zN - 16 - p[2]);
    const sh = shell(G, p => Tp * sstep(0, 3, -R(p[0], p[1])), 0.4, mask, [-2, g.yN - 15, g.zN - 18, 9, g.yG + 8, g.zG + 6], { name: 'procerus' });
    add('procerus', 'procerus', 'shell', sh, [3, g.yN - 10, lm.N[2] + 2], [3, g.yG + 4, g.zG + 3]); }
  // ---- CORRUGATOR SUPERCILII: deep, from the medial supraorbital margin laterally and up to the brow's skin
  { const Tc = T('corrugator'), O = bonePt(8, g.ySupM - 1, 1.3), M = bonePt(g.xOc - 5, g.ySupM + 3, 2.8), I = bonePt(g.xOc + 5, g.ySupM + 7.5, 3.8);
    add('corrugator', 'corrugator supercilii', 'strap', strap([O, M, I], [{ a: 3.4, b: Tc / 2 }, { a: 2.8, b: Tc * 0.42 }, { a: 2.0, b: Tc * 0.3 }], [0, 1, 0]), O, I); }
  // ---- ORBICULARIS OCULI: the orbital part an annulus over the margins (on the deep fat: ROOF above, SOOF below), the palpebral part a
  // thin shell over the globe inside the lids (on the tarsus and conjunctiva)
  { const To = T('orbOculi'), Tpl = T('orbOculiPalp'), gl = B.globe.L, ex = gl.c, gr = gl.r;
    const globeF = { value: (x, y, z) => Math.hypot(x - ex[0], y - ex[1], z - ex[2]) - gr };
    const onBG = { value: (x, y, z) => Math.min(G.value(x, y, z), globeF.value(x, y, z)) };
    const e = (x, y) => Math.hypot((x - g.xOc) / (g.hw + 1.5), (y - g.yOc) / (g.hh + 1.5));
    const front = p => (g.zLatH - 14) - p[2];
    const orbMask = p => Math.max((e(p[0], p[1]) - 1.85) * g.hw, (0.9 - e(p[0], p[1])) * g.hw, front(p));
    const orbT = p => To * sstep(1.85, 1.55, e(p[0], p[1])) * (0.6 + 0.4 * sstep(0.9, 1.15, e(p[0], p[1])));
    const box = [g.xOc - 2.0 * (g.hw + 1.5), g.yOc - 2.0 * (g.hh + 1.5), g.zLatH - 18, g.xOc + 2.0 * (g.hw + 1.5), g.yOc + 2.0 * (g.hh + 1.5), g.cornea + 8];
    const orb = shell(G, orbT, p => lerp(0.9, 2.4, sstep(0.95, 1.2, e(p[0], p[1]))), orbMask, box, { name: 'orbicularis oculi', on: onBG });
    const palMask = p => Math.max((e(p[0], p[1]) - 1.0) * g.hw, ex[2] - 2 - p[2]);
    const pal = shell(G, Tpl, 0.9, palMask, [ex[0] - gr - 2, ex[1] - gr - 2, ex[2] - 4, ex[0] + gr + 2, ex[1] + gr + 2, ex[2] + gr + 3], { name: 'orbicularis oculi (palpebral)', on: globeF });
    add('orbOculi', 'orbicularis oculi', 'shell', D.scene([], 'orbicularis oculi').add(orb).add(pal, 1), [g.xD + 1, g.yOc, g.zMed + 2], [g.xEc + 6, g.yOc - 2, g.zLatH], { sphincter: true }); }
  // ---- the soft points the mimetic straps insert into
  const Mod = soft.mod, sto = soft.sto, up = (x, dy, dz = -4.5) => [x, sto[1] + dy, soft.lipFront(x, sto[1] + dy) + dz], lo = (x, dy, dz = -4.5) => [x, sto[1] + dy, soft.lipFront(x, sto[1] + dy) + dz];
  // ---- LEVATOR LABII SUPERIORIS ALAEQUE NASI: from the frontal process of the maxilla down the side of the nose to the ala and the lip
  { const Tl = T('llsan'), O = bonePt(g.xD + 3.5, g.yN - 7, 1.0), M = bonePt(g.xD + 7, g.yIn - 9, 2.6), I = up(9.5, 8.5);
    add('llsan', 'levator labii superioris alaeque nasi', 'strap', strap([O, M, I], [{ a: 3.0, b: Tl / 2 }, { a: 3.4, b: Tl / 2 }, { a: 3.2, b: Tl * 0.45 }], [0, 0, 1]), O, I); }
  // ---- LEVATOR LABII SUPERIORIS: from above the infraorbital foramen, under the orbicularis oculi, over the deep medial cheek fat
  { const Tl = T('lls'), O = bonePt(g.xOc - 2, g.yIn - 3, 1.6), M = bonePt(g.xOc - 6, (g.yIn + g.yANS) / 2 - 2, 4.6), I = up(14, 7.5);
    add('lls', 'levator labii superioris', 'strap', strap([O, M, I], [{ a: 7, b: Tl / 2 }, { a: 5.2, b: Tl / 2 }, { a: 3.8, b: Tl * 0.45 }], [1, 0, 0.3]), O, I); }
  // ---- ZYGOMATICUS MINOR and MAJOR: from the zygoma's front and lateral surface to the upper lip and the modiolus
  { const Tz = T('zygMinor'), O = bonePt(g.Mal[0] - 7, g.Mal[1] + 2, 1.4), M = v3.lerp(bonePt(g.Mal[0] - 10, (g.Mal[1] + sto[1]) / 2 + 4, 6), O, 0.3), I = up(19, 5.5, -4);
    add('zygMinor', 'zygomaticus minor', 'strap', strap([O, M, I], [{ a: 3, b: Tz / 2 }, { a: 3, b: Tz / 2 }, { a: 2.6, b: Tz * 0.45 }], [1, 0, 0.4]), O, I); }
  { const Tz = T('zygMajor'), xs = surfX(g.Mal[1] - 3, g.Mal[2] - 13) ?? g.Mal[0] + 8, O = onBone(G, [xs, g.Mal[1] - 3, g.Mal[2] - 13], 1.2);
    const M = v3.add(v3.lerp(O, Mod, 0.5), [3, 0, 3]), M2 = v3.lerp(M, Mod, 0.55);
    add('zygMajor', 'zygomaticus major', 'strap', strap([O, M, M2, Mod], [{ a: 5, b: Tz / 2 }, { a: 4.6, b: Tz / 2 }, { a: 4.0, b: Tz / 2 }, { a: 3.4, b: Tz * 0.45 }], [0.55, 0.15, 0.82]), O, Mod); }
  // ---- RISORIUS: from the masseteric fascia forward to the modiolus (superficial, variable)
  { const Tr = T('risorius'), xr = (surfX(sto[1] - 3, lm.Go_L[2] + 22) ?? K.goGo / 2) + T('masseter') + 1.5, O = [xr, sto[1] - 3, lm.Go_L[2] + 20], M = v3.add(v3.lerp(O, Mod, 0.5), [2, 0, 2]);
    add('risorius', 'risorius', 'strap', strap([O, M, Mod], [{ a: 4.5, b: Tr / 2 }, { a: 3.6, b: Tr / 2 }, { a: 2.6, b: Tr / 2 }], [0, 1, 0]), O, Mod); }
  // ---- BUCCINATOR: a sheet on the buccal mucosa from the pterygomandibular raphe to the modiolus, between the alveolar processes
  { const Tb = T('buccinator'), uT = B.arch.upT, lT = B.arch.lowT, off = (o, d) => v3.add(o.p, v3.mul(o.n, d)), dz = 1.6 + Tb / 2;
    const rowTop = [v3.add(off(uT[6], dz), [0, 9, -9]), v3.add(off(uT[6], dz), [0, 9, 0]), v3.add(off(uT[5], dz), [0, 9, 0]), v3.add(off(uT[4], dz + 0.5), [0, 8, 0]), v3.add(Mod, [-3, 4, -2.5])];
    const rowMid = [v3.add(v3.lerp(off(uT[6], dz), off(lT[6], dz), 0.5), [0, 0, -10]), v3.lerp(off(uT[6], dz), off(lT[6], dz), 0.5), v3.lerp(off(uT[5], dz + 0.4), off(lT[5], dz + 0.4), 0.5), v3.lerp(off(uT[4], dz + 1), off(lT[4], dz + 1), 0.5), v3.add(Mod, [-3, 0, -3])];
    const rowBot = [v3.add(off(lT[6], dz), [0, -9, -9]), v3.add(off(lT[6], dz), [0, -9, 0]), v3.add(off(lT[5], dz), [0, -9, 0]), v3.add(off(lT[4], dz + 0.5), [0, -8, 0]), v3.add(Mod, [-3, -4, -2.5])];
    const sh = D.smoothSheet([rowTop, rowMid, rowBot], [[Tb / 2, Tb / 2, Tb / 2, Tb / 2, Tb * 0.4], [Tb / 2, Tb / 2, Tb / 2, Tb / 2, Tb * 0.45], [Tb / 2, Tb / 2, Tb / 2, Tb / 2, Tb * 0.4]], { nu: 2, nv: 3 });
    add('buccinator', 'buccinator', 'sheet', sh, rowMid[0], Mod); }
  // ---- DEPRESSOR ANGULI ORIS: from the oblique line near the lower border, converging up to the modiolus
  { const Td = T('dao'), lT = B.arch.lowT, base = (o, dy) => { const p0 = v3.add([o.p[0], g.yMe + dy, o.p[2]], v3.mul(o.n, 40)), h = hitBone(G, p0, v3.mul(o.n, -1), 60) || [o.p[0], g.yMe + dy, o.p[2]]; return onBone(G, h, 1.4); };
    const O = v3.lerp(base(lT[3], 8), base(lT[4], 7), 0.5), M = v3.add(v3.lerp(O, Mod, 0.5), [1.5, 0, 2]);
    add('dao', 'depressor anguli oris', 'strap', strap([O, M, v3.add(Mod, [0, -2, 0])], [{ a: 9, b: Td / 2 }, { a: 5.5, b: Td / 2 }, { a: 2.6, b: Td * 0.45 }], v3.norm(v3.sub(base(lT[4], 7), base(lT[3], 8)))), O, Mod); }
  // ---- DEPRESSOR LABII INFERIORIS: from the mandible between the symphysis and the mental foramen up-medially to the lower lip
  { const Td = T('dli'), lT = B.arch.lowT, p0 = v3.add([lT[2].p[0], g.yMe + 11, lT[2].p[2]], v3.mul(lT[2].n, 40)), h = hitBone(G, p0, v3.mul(lT[2].n, -1), 60) || p0, O = onBone(G, h, 1.2), I = lo(8, -8.5);
    add('dli', 'depressor labii inferioris', 'strap', strap([O, v3.add(v3.lerp(O, I, 0.5), [0, 0, 1.5]), I], [{ a: 5.5, b: Td / 2 }, { a: 4.6, b: Td / 2 }, { a: 3.8, b: Td * 0.45 }], [1, 0, 0.2]), O, I); }
  // ---- MENTALIS: from the incisive fossa down and forward into the chin's skin (the chin pad)
  { const Tm = T('mentalis'), O = bonePt(4.2, lm.Id[1] - 9, 0.8), Ib = bonePt(5, lm.Pog[1] - 3, 0), nI = v3.norm(v3.sub(bonePt(5, lm.Pog[1] - 3, 1), Ib)), I = v3.add(Ib, v3.mul(nI, 1 + Tm));
    add('mentalis', 'mentalis', 'strap', strap([O, v3.lerp(O, I, 0.5), I], [{ a: 4.5, b: Tm * 0.4 }, { a: 5.5, b: Tm / 2 }, { a: 5.5, b: Tm * 0.45 }], [1, 0, 0]), O, I); }
  // (it6) the ANTERIOR BELLIES OF THE DIGASTRIC (the floor of the mouth under the chin: the submental contour between the mandible and the
  // hyoid, a volume the skin lies on): from the digastric fossa on the inner side of the symphysis' lower border to the intermediate tendon
  // at the hyoid's body, sagging a little between (left; mirrored with the rest)
  { const Td = T('digastricAnt'), Me = lm.Me, Hy = lm.Hyoid || [0, Me[1] + 1, Me[2] - 30], O = [7, Me[1] + 3, Me[2] - 6], I = [12, Hy[1] + 3, Hy[2] + 3], M = v3.add(v3.lerp(O, I, 0.5), [0.5, -2.5, 0]);
    add('digastricAnt', 'digastric (anterior belly)', 'belly', strap([O, M, I], [{ a: 4, b: Td * 0.4 }, { a: 4.6, b: Td / 2 }, { a: 3.2, b: Td * 0.4 }], [1, 0, 0]), O, I); }
  // ---- PLATYSMA (its upper part: over the mandible's body and lower border, into the upper neck; ANAT8-BODY's below the hyoid)
  { const Tp = T('platysma'), Go = lm.Go_L, Me = lm.Me, Hy = lm.Hyoid, lT = B.arch.lowT, rows = [];
    const at = (x, y, z, lift) => { const p = [x, y, z], n = v3.norm([x, -6, 0.3 * (z - Go[2])]); const h = hitBone(G, v3.add(p, v3.mul(n, 40)), v3.mul(n, -1), 70); return h ? onBone(G, h, lift) : p; };
    const zs = [Me[2] - 6, lT[3].p[2] - 4, (lT[5].p[2] + Go[2]) / 2, Go[2] + 2], xs = [13, lT[3].p[0] + 3, (lT[5].p[0] + Go[0]) / 2 + 2, Go[0] + 3];
    rows.push(xs.map((x, i) => at(x, g.yMe + 15, zs[i], 3.2)));
    rows.push(xs.map((x, i) => at(x + 2, g.yMe - 1, zs[i] - 2, 4.2)));
    rows.push(xs.map((x, i) => [x + 4 + 2 * i, Hy[1] - 4, lerp(Hy[2] + 8, Go[2] - 12, i / 3)]));
    const sh = D.smoothSheet(rows, Tp / 2, { nu: 2, nv: 3 });
    add('platysma', 'platysma', 'sheet', sh, rows[2][1], rows[0][1]); }
  // ---- ORBICULARIS ORIS: the upper and lower lips' arcs from modiolus to modiolus (built whole, not mirrored)
  const whole = [];
  { const To = T('orbOris'), xs = [-Mod[0], -0.72 * Mod[0], -0.4 * Mod[0], 0, 0.4 * Mod[0], 0.72 * Mod[0], Mod[0]];
    const hU = Math.max(14, soft.sn[1] - sto[1] - 1.5);    // the upper lip's height (sto to the subnasale): the muscle fills most of it
    // the arcs' fronts lie at the lips' front (the table's ls / li depth, head/index.js lipFront) less the lip's skin (1.2) and a 1 mm
    // subcutaneous layer, never closer than 2.4 mm to the teeth (the mucosa and the labial glands): the lips' bulk is the muscle's
    for (const [dy, a, nm] of [[0.5 * hU + 0.3, 0.45 * hU, 'upper'], [-7.2, 6.6, 'lower']]) { const pts = xs.map((x, i) => (i === 0 || i === 6) ? [x, Mod[1] + dy * 0.35, Mod[2]] : [x, sto[1] + dy, Math.max(soft.toothFront(x, sto[1] + dy) + 2.4 + To / 2, soft.lipFront(x, sto[1] + 0.55 * dy) - 2.2 - To / 2)]);
      const secs = xs.map((_, i) => (i === 0 || i === 6) ? { a: 3, b: 2.2 } : { a: a * (i === 1 || i === 5 ? 0.85 : 1), b: To / 2, n: 2.4 });
      // the section leans with the lip's profile: the upper lip's top back toward the subnasale, the lower lip's bottom back toward the
      // mentolabial sulcus (an upright section put the lips' bases 2-7 mm ahead of the mid-philtrum and supramentale sites)
      const upv = nm === 'upper' ? [0, 1, -0.4] : [0, 1, 0.4];
      whole.push({ key: 'orbOris', name: `orbicularis oris (${nm} lip)`, kind: 'ring', side: 'C', T: f2(To), origin: r1(pts[0]), insertion: r1(pts[6]), line: [1, 0, 0], rest: f1(xs.length), prim: { ...strap(pts, secs, upv), label: LBL.muscle, name: `orbicularis oris (${nm} lip)` }, sphincter: true }); } }
  // ---- assembled: each left muscle and its mirror
  const prims = []; for (const r of list) { prims.push(r.prim); prims.push(D.mirrorX(r.prim, { label: LBL.muscle, name: r.name + '_R' })); }
  for (const r of whole) { prims.push(r.prim); list.push(r); }
  const report = Object.fromEntries(list.map(r => [r.name, { T: r.T, origin: r.origin, insertion: r.insertion, rest: r.rest, kind: r.kind }]));
  if (masBorder) report.masseterBorder = masBorder;
  return { list, prims, report, version: MUSCLES_VERSION };
}
