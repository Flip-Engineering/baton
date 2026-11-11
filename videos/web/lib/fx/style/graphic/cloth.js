// STYLE c3: HATCHING THAT FOLLOWS THE CLOTH (STYLE c2's hand-off). STYLE c2's drawn styles hatch a garment by the body chain it
// rides (draw/fields.js), so the lines run round the limb whatever the cloth does. A sewn garment (CLOTHING K2/K3, CLOTH3) carries
// its PATTERN coordinates: uv in metres on the flat panel, v along the warp (the grain line), u across it. A line drawn at a fixed
// v is a thread of the weft: it lies ON the fabric, so every fold, drape and pull bends it as the cloth bends (the way a striped
// shirt shows its folds). clothPhases(h) writes those coordinates into the drawing fields of every garment that has them:
//   aDr0.x (the cross-contour phase) = v (the weft), aDr0.y (along the form) kept as STYLE c2's, fibre off, purity 1
// Opt-in per hero, after installDraw (DrawStage.render installs it; call clothPhases after a first render or after installDraw).
// GraphicStage's own styles read the uv directly (glsl.js, FAB_UVQ). Panels keep their own origins, so the lines break at the
// seams as a real fabric's pattern does.
export function clothPhases(h) {
  let n = 0;
  h.group.traverse(m => {
    if (!m.isMesh) return; const g = m.geometry, uv = g.attributes.uv, a0 = g.attributes.aDr0, a1 = g.attributes.aDr1, mat = [].concat(m.material)[0];
    if (!uv || !a0 || !a1 || !(mat?.defines && mat.defines.FAB_UVQ)) return;
    if (!g.userData.drClothKeep) g.userData.drClothKeep = { a0: a0.array.slice(), a1: a1.array.slice() };
    // the first family (cross-contour) becomes the weft; the second keeps STYLE c2's along-the-form phase (the pattern's u as a second
    // family drew a woven check, graph paper, on the first bust board); fibre off
    for (let i = 0; i < uv.count; i++) { a0.array[i * 4] = uv.array[i * 2 + 1]; a0.array[i * 4 + 2] = 0; a0.array[i * 4 + 3] = 0; a1.array[i * 4] = 1; }
    a0.needsUpdate = true; a1.needsUpdate = true; n++;
  });
  return n;
}
// back to STYLE c2's body-chain phases on the garments (exactly as they were)
export function clothPhasesOff(h) {
  h.group.traverse(m => { if (!m.isMesh) return; const g = m.geometry, k = g.userData.drClothKeep; if (!k) return; g.attributes.aDr0.array.set(k.a0); g.attributes.aDr1.array.set(k.a1); g.attributes.aDr0.needsUpdate = g.attributes.aDr1.needsUpdate = true; });
}
