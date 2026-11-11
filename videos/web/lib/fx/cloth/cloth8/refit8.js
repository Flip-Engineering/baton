// CLOTH8 c5 it2 (15 Oct): THE CLOTHES RIDE THE TISSUE THAT MOVED UNDER THEM. The bake's parts (the underwear, the garments) are fitted, in
// bind space, on the body the bake was made on. Since 8 Oct the person goes on growing AFTER the parts are attached (person/build.js: BODY7's
// girdle, ANAT8-BODY's soft solve fitSkin7, ANAT8-PELVIS's pelvis7: up to 6 cm of bind-space change on L08's hips and belly, 2.7k vertices
// moved > 5 mm), and nothing told the cloth: on the merged person (GPU 1008-233823) the women's briefs showed skin-coloured holes where the
// solved belly and hips now lie OUTSIDE the shell, and flat tabs where the body withdrew from under the shell's side panels.
// Real underwear is stretched jersey in contact with the skin: where the tissue goes, the cloth goes (no slip at this scale). So every
// vertex of a part is BOUND to the body surface it was fitted on (barycentric point of the nearest triangle + its height along that
// triangle's normal + the residual: carry8's bind8) and PLACED on the same triangle of the body the person ends with (place8); the
// part keeps its own offset (its thickness, the membrane's bridge over a hollow, a binding's roll), its weights and its topology; nothing
// is aimed at a shape. A last guard lifts any vertex the move placed (only those) inside the new skin (closest point, signed height < `floor`) to `floor`.
// Where the body did not move, the part is byte-identical.
//   refitParts8(parts, X0, X1, T, { groups })   bake records (bind metres; parts[i].X edited in place) -> report
//   refitPerson8(P, X0)                         a built person (the integrator's hook: X0 = the body's bind positions when the parts were
//                                               attached, P.parts' geometry edited in place, after the last body stage) -> report
// cup8 (c6 it1, 15 Oct): after the placement, the bra's moulded cup (cup8.js cupPerson8: a stiff panel on the breast's form, the tissue pressed
// under it); { cup8: false } is the A/B, { cup8: {...} } its options.
// contact8 (c6 it2, 15 Oct): the body-contact shell; since c7 it1 run by cover8 as its last step ({ cover8: { contact8: false } } the A/B).
// groups: which part groups ride (default: the underwear, 'found'; the garments' hang over a changed body is CLOTH9's settle).
import { SurfaceMesh } from '../collide.js';
import { bind8, place8 } from './carry8.js';
import { cupPerson8 } from './cup8.js';
import { briefPerson8 } from './brief8.js';
export const REFIT8_VERSION = 2;   // (c10 it1) + brief8: the brief made on the final body
export const REFIT8_DEFAULT = { groups: ['found'], reach: 0.04, floor: 0.0004, moved: 0.0005 };

// the body's per-vertex change, and which triangles of the body moved at all (a part bound to an unmoved triangle stays byte-identical)
function movedMask(X0, X1, eps) { const n = X0.length / 3, m = new Uint8Array(n); let k = 0, mx = 0;
  for (let v = 0; v < n; v++) { const d = Math.hypot(X1[v * 3] - X0[v * 3], X1[v * 3 + 1] - X0[v * 3 + 1], X1[v * 3 + 2] - X0[v * 3 + 2]); if (d > eps) { m[v] = 1; k++; } mx = Math.max(mx, d); }
  return { m, k, maxMm: +(mx * 1000).toFixed(1) }; }

export function refitParts8(parts, X0, X1, T, o = {}) {
  const { groups, reach, floor, moved } = { ...REFIT8_DEFAULT, ...o };
  const MV = movedMask(X0, X1, moved), rep = { version: REFIT8_VERSION, bodyMoved: MV.k, bodyMaxMm: MV.maxMm, parts: {} };
  if (!MV.k) return rep;
  const S0 = new SurfaceMesh(X0, T, { cell: 0.015 }), S1 = new SurfaceMesh(X1, T, { cell: 0.015 });
  for (const q of parts) { if (!groups.includes(q.group) || !q.X?.length) continue;
    const Xq = Float64Array.from(q.X), B = bind8(Xq, X0, T, { reach, surf: S0 }), Y = Float64Array.from(Xq), k = place8(B, X1, T, Y, MV.m);
    let lifted = 0, mx = 0; if (k) for (let v = 0; v < Y.length / 3; v++) { if (B.tri[v] < 0 || (Y[v * 3] === Xq[v * 3] && Y[v * 3 + 1] === Xq[v * 3 + 1] && Y[v * 3 + 2] === Xq[v * 3 + 2])) continue; const c = S1.closestAny(Y[v * 3], Y[v * 3 + 1], Y[v * 3 + 2], 0.02);
      if (c && !c.edge && c.d < floor) { const s = floor - c.d; Y[v * 3] += c.nx * s; Y[v * 3 + 1] += c.ny * s; Y[v * 3 + 2] += c.nz * s; lifted++; } }
    for (let v = 0; v < Y.length / 3; v++) mx = Math.max(mx, Math.hypot(Y[v * 3] - Xq[v * 3], Y[v * 3 + 1] - Xq[v * 3 + 1], Y[v * 3 + 2] - Xq[v * 3 + 2]));
    q.X = q.X instanceof Float32Array ? Float32Array.from(Y) : Y;
    const key = `${q.owner || ''}:${q.name}`; rep.parts[key] = { verts: Y.length / 3, placed: k, lifted, maxMoveMm: +(mx * 1000).toFixed(1) }; }
  return rep;
}

// the built person: its parts are SkinnedMeshes (person/core.js partMesh2: position = bind metres / scale, userData.k3 = the bake record);
// X0 / X1 in the body's own position units (the hero's scale), so no scale enters
export function refitPerson8(P, X0, o = {}) {
  const g = P.h?.body?.geometry; if (!g || !X0) return { skipped: 'no body or no X0' };
  const X1 = Float64Array.from(g.attributes.position.array); if (X1.length !== X0.length) return { skipped: 'the body changed topology' };
  const T = Int32Array.from((P.bodyIndexFull || g.index).array ?? (P.bodyIndexFull || g.index));
  const groups = o.groups || REFIT8_DEFAULT.groups, recs = [];
  for (const m of P.parts || []) { const k3 = m.userData?.k3, pg = m.geometry; if (!k3 || !groups.includes(k3.group) || !pg?.attributes?.position) continue; recs.push({ m, rec: { group: k3.group, owner: k3.owner, name: k3.name, X: Float64Array.from(pg.attributes.position.array) } }); }
  if (typeof o.probe === 'function') o.probe({ X0, X1, T, parts: recs.map(r => ({ ...r.rec, X: Float64Array.from(r.rec.X) })) });   // (c10) a lab's read of the bind before the move; no effect
  const rep = refitParts8(recs.map(r => r.rec), X0, X1, T, o);
  for (const { m, rec } of recs) { const a = m.geometry.attributes.position; a.array.set(rec.X); a.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere?.(); }
  // (c6 it1) the moulded cup on the body the person ends with: the panel relaxed and resting on the breast, the tissue pressed under it (cup8.js)
  if (o.cup8 !== false) { try { rep.cup8 = cupPerson8(P, o.cup8); } catch (e) { rep.cup8 = { error: String(e.message || e) }; } }
  // (c10 it1) the brief MADE on the body the person ends with (brief8.js: foundations.js's fit on the final body, not the bake's carried by
  // nearest triangles: the carry left a 4-5 cm bag below the crotch on every woman); { brief8: false } is the A/B
  if (o.brief8 !== false) { try { rep.brief8 = briefPerson8(P, o.brief8); } catch (e) { rep.brief8 = { error: String(e.message || e) }; } }
  // (c7 it1) the body-contact shell (contact8) moved to cover8's last step: cover8 runs after this hook and moved the skin under it (CHECK c6 F1)
  return rep;
}
