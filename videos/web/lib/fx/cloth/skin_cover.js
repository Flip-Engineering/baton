// HUMAN c8 HOOKS (H3) for the stack: the skin under drawn cloth is not drawn. hero.js reads an optional per-vertex float attribute
// aCover on h.body.geometry (1 = covered) when the skin material has defines.SKIN_COVER, and discards those fragments before its region
// tests (the body still casts its shadow). Without the define the skin shader is byte for byte what it was.
// The covered test is the stack's garment cull (stack.js cullCovered) applied to the body: a body vertex, posed, whose nearest drawn
// cloth of any draped garment lies on its outer side (the skin is inside the cloth: a hand hanging beside a coat is not), is not an edge,
// and lies CULL_RINGS rings or more from that garment's boundary (a neck opening, a cuff, a hem). It follows the solved cloth, so it holds for an undershirt, a rolled
// sleeve or a garment taken off (hero.js's own y-band cover, hCover, cannot), and dressPerson turns hCover off for a hero it covers this way.
//   dressPerson(h, outfit, { skinCover: true })   -> report.skinCover = { covered, of }
import * as THREE from 'three';
import { poseP } from './drape.js';

export function coverSkin(h, ctx, draped, { reach = 0.05 } = {}) {
  if (typeof h.useSkinHook !== 'function') return { covered: 0, of: 0, note: 'hero.js without the HOOKS pass: no aCover' };
  const g = h.body.geometry, P = g.attributes.position.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = P.length / 3, S = ctx.S;
  const overs = draped.filter(B => B.visSurf && B._deep), a = new Float32Array(n); let k = 0;
  if (overs.length) { const X = new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) X[i] = P[i] * S;
    const Xp = poseP(ctx, X, SI, SW);
    const AH = h.aHero, skip = new Set([0, 5, 6, 11]);   // never the head, jaw, hands or fingers (a hand resting on a thigh lies inside the trousers' surface)
    for (let v = 0; v < n; v++) if (!skip.has(AH[v * 4])) for (const B of overs) { const q = B.visSurf.closest(Xp[v * 3], Xp[v * 3 + 1], Xp[v * 3 + 2], reach); if (q && q.d < 0 && !q.edge && B._deep(q.tri)) { a[v] = 1; k++; break; } } }
  g.setAttribute('aCover', new THREE.BufferAttribute(a, 1));
  const m = h.body.material; m.defines = { ...(m.defines || {}), SKIN_COVER: 1 }; m.needsUpdate = true;
  if (h.skinU.hCover) h.skinU.hCover.value.w = 0;                   // the garment-driven cover replaces hero.js's y bands
  return { covered: k, of: n };
}
