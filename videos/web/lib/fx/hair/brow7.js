// FACE7 (round 7): the brows' MATERIAL under face rev 8 (FACE7's file; HAIR7 owns shade.js and index.js, which this only reads through
// the live uniforms hairMaterial exposes on mat.userData.hairU). AUDIT7 cause 9: the card brows read as strokes with a blue-grey sheen
// (the primary lobe and the environment sheen of a fibre lit at the brow's angle, on dark and grey brows alike) and too little cover.
// Here, on the brows' mesh only: the primary (R) lobe and the TRT lobe lower, the environment sheen lower, grey brows less white (a grey
// brow is mixed pepper-and-salt, not frost), the cards' alpha a little higher (cover). Opt-in: only face7.js calls it (face3: { f7: {} }).
//   browMaterial7(h, { specR, specTRT, eGain, greyK, alphaGain }) -> report
//
// FACE7 c7 it 18 (15 Oct): THE LASHES AS THE LASHES THEY ARE (lashMaterial7, rewritten). Until now (it 6) the lash rows were the atlas'
// lash tile (four strands tapering over 70 % of their length and converging, squeezed into a card, coverage x2.4) under three sheen
// multipliers set by look (the R lobe 0.5 -> 0.18, the TRT x0.35, the environment sheen x0.25) and a constant root darkening 0.55, to hide
// a cream fringe the critics kept seeing. The fringe never was the lash's shading (its diffuse albedo is ~0.0004 at L08's eu 2.7; the
// lobes add a few per cent of the key): the multipliers treated a symptom and are DELETED (the lashes take the face cards' fibre lobes as
// HAIR builds them, hair/index.js). What the lash IS: a terminal hair ~0.10 mm at the root (upper; ~0.075 lower: hair/face.js
// growLashesFol's cal), never cut, so constant along the shaft with a natural point over its distal third (fibre.js SHAFT.natural); the
// upper row gathers in clumps of 3-5 toward the tips (the card's narrowing, w1); the lower row single lashes. So each lash card draws ITS
// OWN lashes at that calibre (lashStrands7, the brows' browStrands7 rule: hair/face.js LASH_CARD7 gives the count and the share of the
// card's root width a lash is, the same numbers growLashesFol built the card from), its coverage the hairs' true fraction (alpha gain 1:
// no gain over the hair's silhouette), and Cycles draws the same hairs (blender/person_hair.py LASH7, from the record this writes on the
// material: userData.shade.lash7) in the person's own fibre BSDF.
//   lashMaterial7(h, { strands: { up: {...}, lo: {...} } | false, loMel }) -> report
// loMel: the lower row takes the upper's pigment (the same follicles' melanin; index.js lightened it x0.55 to make a card row read finer:
// the row's lightness is its calibre). strands false: the atlas tile at index.js's material (the it 18 bench's control arm only).
export function browMaterial7(h, o = {}) {
  const rep = { meshes: 0 };
  h.group?.traverse?.(m => { if (!m.isMesh || m.userData?.hairPart !== 'brows') return; const U = m.material?.userData?.hairU; if (!U) return;
    if (U.hSpec) { if (o.specR != null) U.hSpec.value.x = o.specR; if (o.specTRT != null) U.hSpec.value.y *= o.specTRT; }
    if (U.h5S && o.eGain != null) U.h5S.value.y *= o.eGain;
    if (U.hGrey && o.greyK != null) U.hGrey.value *= o.greyK;
    if (U.hMisc && o.alphaGain != null) U.hMisc.value.x = o.alphaGain;
    if (o.strands) rep.strands = browStrands7(m.material, o.strands);
    rep.meshes++; rep.spec = U.hSpec ? [+U.hSpec.value.x.toFixed(3), +U.hSpec.value.y.toFixed(3)] : null; rep.grey = U.hGrey ? +U.hGrey.value.toFixed(3) : null; });
  return rep;
}
export function lashMaterial7(h, o = {}) {
  const rep = { meshes: 0, parts: [] }; let up = null; const meshes = [];
  h.group?.traverse?.(m => { const part = m.userData?.hairPart; if (!m.isMesh || (part !== 'lashes' && part !== 'lashesLow')) return; const U = m.material?.userData?.hairU; if (!U) return;
    meshes.push(m); if (part === 'lashes') up = U; rep.meshes++; rep.parts.push(part); });
  for (const m of meshes) { const part = m.userData.hairPart, U = m.material.userData.hairU, q = o.strands ? o.strands[part === 'lashes' ? 'up' : 'lo'] : null;
    if (q) { U.hMisc.value.x = 1; rep[part] = lashStrands7(m.material, q); m.material.userData.shade = { ...(m.material.userData.shade || {}), lash7: { n: q.n, strand: q.strand, sd: q.sd, tip: q.tip, k: q.k } }; }
    if (part === 'lashes') { rep.spec = U.hSpec ? [+U.hSpec.value.x.toFixed(3), +U.hSpec.value.y.toFixed(3)] : null; rep.eGain = U.h5S ? +U.h5S.value.y.toFixed(3) : null; rep.rootDark = U.hMisc ? +U.hMisc.value.y.toFixed(3) : null; rep.alpha = +U.hMisc.value.x.toFixed(3); } }
  if (o.loMel && up) for (const m of meshes) { if (m.userData.hairPart !== 'lashesLow') continue; const U = m.material.userData.hairU;
    for (const k of ['hSig', 'hTc', 'h5Trt']) if (U[k] && up[k]) U[k].value.copy(up[k].value); rep.loMel = true; }
  return rep;
}

// FACE7 c6 it 15 (15 Oct): THE BROW CARD DRAWS A BROW'S HAIRS, NOT THE SCALP ATLAS' BROW TILE (o.strands; face7.js passes it with
// brows.fol). In the engine the follicle brows read as a faint grey hatch where a brow is a dark mass of hair (bench 1015-090041 dn15;
// the critic, it 14). The field holds the anatomy's hairs (L03 ~400 a side at 0.09 mm, ~8 mm long: ~0.8 of the band's area in hair
// before overlap), but each card drew whatever half of the atlas' brow tile its rand picked (index.js ua = 0.45 rand): the tile's 11
// strands are 0.55-0.95 of the card long, taper over 80 % of it, fade at the root and arc out of the half window, so a card covered
// ~0.12-0.25 of its area (mean 0.21 where its 4 hairs at the calibre cover 0.22 at the root and more toward the tip, where the card
// narrows: conv) and some cards drew one or two hairs. Here the card's coverage is its own hairs, the same hairs person_hair.py's BROW7
// draws in Cycles: `n` hairs across the card (the clump), each STRAND of the card's ROOT width wide for its whole length (so as the
// card narrows by conv the hair keeps its calibre), +-sd hair to hair, the natural point over the last `tip` of the shaft to k of the
// root's width, each hair ending at 0.85-1.0 of the card (the clump's hairs are not cut to one length), spaced across the card with a
// little jitter and a slight lean; coverage box-filtered over the pixel's footprint across the card (analytic, so a sub-pixel hair adds
// its true fraction and the shade's stochastic threshold averages it over the sub-frames). The atlas is still sampled for nothing else
// (tx.r: the strand's id for its own melanin, tx.b: its lightness, both given per hair here). Shadows: the depth pass keeps the atlas.
export const BROW_STRANDS7 = { n: 4, strand: 0.055, conv: 0.75, sd: 0.10, tip: 0.35, k: 0.25 };
export function browStrands7(mat, o = {}) {
  const q = { ...BROW_STRANDS7, ...(o === true ? {} : o) }, f = x => (+x).toFixed(4);
  // the brow card's window on the atlas: its brow tile (slot 6), half of it from 0.45 x the card's random (hair/index.js ua)
  const GLSL = strandsGLSL(q, `float uT0 = ${f((6 * 128 + 2) / 2048)}, uT1 = ${f((7 * 128 - 2) / 2048)};
    float sC = ((vHUV.x - uT0) / (uT1 - uT0) - 0.45 * vHair.z) / 0.5, tC = clamp(fract(vHUV.y), 0.0, 1.0);`, 'brow7: the card\'s own hairs', false);
  return patchStrands(mat, GLSL, `|brow7s${q.n}_${q.strand}_${q.conv}_${q.tip}`, q);
}
// (c7 it 18) the LASH card's own lashes: n a card (4: the upper clump; 1: the lower row's single lash), each `strand` of the card's root
// width wide (its calibre: hair/face.js LASH_CARD7), the natural point over the last `tip` to k; the card's window on the lash tile (slot 7)
// from ua to ub (hair/index.js: the upper card the whole tile, the lower a slice); `gather`: the hairs keep their place ACROSS the card, so as
// the card narrows toward the tip (w1: the clump gathering) they converge, their calibre kept.
export const LASH_STRANDS7 = { sd: 0.10, tip: 0.35, k: 0.25 };
export function lashStrands7(mat, o = {}) {
  const q = { ...LASH_STRANDS7, conv: 0.65, ua: 0, ub: 1, ...o }, f = x => (+x).toFixed(4);
  const GLSL = strandsGLSL(q, `float uT0 = ${f((7 * 128 + 2) / 2048)}, uT1 = ${f((8 * 128 - 2) / 2048)};
    float sC = ((vHUV.x - uT0) / (uT1 - uT0) - ${f(q.ua)}) / ${f(Math.max(1e-3, q.ub - q.ua))}, tC = clamp(fract(vHUV.y), 0.0, 1.0);`, 'lash7: the card\'s own lashes', true);
  return patchStrands(mat, GLSL, `|lash7s${q.n}_${q.strand}_${q.conv}_${q.tip}_${q.ua}`, q);
}
// the GLSL that stands in for the atlas read: tx = (the strand's id for its melanin, the hairs' coverage, their lightness, 1)
function strandsGLSL(q, head, label, gather) {
  const f = x => (+x).toFixed(4), n = Math.max(1, Math.min(8, q.n | 0));
  const place = gather ? `0.5 + ((fk + 0.5) / ${n.toFixed(1)} - 0.5) * 0.8 + (r2 - 0.5) * ${n > 1 ? '0.12' : '0.30'} + (r1 - 0.5) * 0.10 * tC`
    : `0.5 + ((fk + 0.5) / ${(Math.max(1, q.n | 0)).toFixed(1)} - 0.5) * 0.8 / wRel + (r2 - 0.5) * 0.12 + (r1 - 0.5) * 0.10 * tC`;
  return `vec4 tx;
  { // (FACE7 ${label})
    ${head}
    float fw = max(abs(dFdx(sC)) + abs(dFdy(sC)), 1e-4);
    float wRel = 1.0 + (${f(q.conv)} - 1.0) * pow(tC, 1.1);            // the card's width here / at the root
    float cov = 0.0, sidB = 0.0, lB = 0.6, best = 0.0;
    for (int k = 0; k < 8; k++) { if (k >= ${n}) break;
      float fk = float(k), r1 = fract(sin(vHair.z * 91.7 + fk * 12.9898) * 43758.5453), r2 = fract(sin(vHair.z * 47.3 + fk * 78.233) * 24634.6345), r3 = fract(r1 * 7.13 + r2 * 3.71);
      float end = 0.85 + 0.15 * r3; if (tC > end) continue;
      float tt = tC / end, pt = 1.0 - (1.0 - ${f(q.k)}) * smoothstep(1.0 - ${f(q.tip)}, 1.0, tt);
      float hw = 0.5 * ${f(q.strand)} * (1.0 + ${f(q.sd)} * (2.0 * r1 - 1.0)) * pt / wRel;   // half the hair's width in card widths (its calibre kept as the card narrows)
      float c = ${place};
      float a = clamp((min(sC + 0.5 * fw, c + hw) - max(sC - 0.5 * fw, c - hw)) / fw, 0.0, 1.0);
      cov += a; if (a > best) { best = a; sidB = fk + 1.0 + 8.0 * floor(r2 * 30.0); lB = 0.45 + 0.4 * r3; }
    }
    tx = vec4(sidB / 255.0, clamp(cov, 0.0, 1.0), lB, 1.0);
  }`;
}
function patchStrands(mat, GLSL, key, q) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat), rep = { ...q, patched: null };
  mat.userData.strands7 = { ...q };   // (c7 it 19) the card's hairs as numbers, for what needs their cover off the GPU (face/cavity7.js)
  mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); const a = 'vec4 tx = textureGrad(hAtlas, uvH, dFdx(vHUV), dFdy(vHUV));';
    rep.patched = sh.fragmentShader.includes(a); if (rep.patched) sh.fragmentShader = sh.fragmentShader.replace(a, GLSL); };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key; mat.needsUpdate = true;
  return rep;
}
