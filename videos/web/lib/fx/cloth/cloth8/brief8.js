// CLOTH8 c10 it1 (16 Oct): THE BRIEF MADE ON THE BODY THE PERSON ENDS WITH. On the merged person (ANAT8-PELVIS job N 1015-222710, bare
// window@5; the orchestrator's 14:15 look) every woman's brief hung its gusset 2-4 cm below the crotch as a rounded pouch between the
// thighs (it read as a male bulge), with skin through at the left hip and ragged leg openings.
// Measured on the built person (labs/clothing2/cloth8/brief_dump.mjs, brief_gusset.mjs, brief_slices.mjs; review/studio_clothing_c2/
// after/cloth8/measures/c10it1_briefs.md), L08 L22 L06 L12 in bind: along the midline the drawn gusset lies 1-8 mm off the perineum
// except over 2-3 cm at the FRONT of the fork, where it hangs 43-47 mm below it: in the frontal section the shell runs down both inner
// thighs and closes BELOW the gap between them, a bag. The bake's brief (K3, foundations.js, fitted on the body of its day) already hangs
// 33-36 mm there against the body it is attached to (X0), and refit8's carry (each vertex on the nearest skin triangle before the anatomy
// stages, placed on the same triangle after) keeps the bag and deepens it: across the fork the nearest triangle is a thigh's, so the
// gusset's sides ride the solved thighs, not the perineum. The brief's own method was never the fault: fitted by foundations.js on the
// body the person ENDS with (labs/clothing2/cloth8/brief_fit_test.mjs on the same dumps), the same gusset lies 1-2 mm off the perineum at
// every point of the midline, front to back, for all four women: its tension shell (the knit under negative ease relaxed over the body
// as a membrane, its elastic edges on the skin) cannot hang below the perineum it is stretched over.
// So the brief is no longer carried: refit8's hook MAKES it, for every person, on the body the build ends with (after BODY7's girdle,
// the girdle layer, the soft solve, pelvis7 and NOSEMOUTH; before fine7, seat9 and cover8):
//   (1) fitFoundation (foundations.js: the outline from the person's landmarks, the region cut, the membrane in tension, the elastic
//       edges held on the skin) on the final body's own vertices (Loop level 0 of the drawn mesh), the kind the bake wore (women's
//       briefs, men's briefs or boxer briefs), its colours. The outline's leg opening now runs in the crease at the fork (foundations.js
//       'THE FORK', c10 it1): fitted on the final body WITHOUT it, the stance still pinched a 2-4 cm flap at the front of the fork on L12
//       and L22 (the planes take both walls of the gap between the thighs 2.5-4.5 cm down, and the adducted thighs fold them together);
//   (2) the shell kept `gap` outside the DRAWN skin (the full detailed surface the person renders: the fit's collider is the base mesh
//       with Phong midpoints), then its bindings swept along its edges (foundationData); every part skinned from the skin it LIES ON
//       (skinUnder: the closest skin triangle's blend), so it rides that skin into the stance;
//   (3) the meshes the bake drew are given the new geometry (the attributes partMesh2 builds; FABRIC6's when the old ones had them);
//   (4) bare: the skin culled under the brief is the skin the NEW brief covers (no hole where an edge moved, none drawn under it).
// Nothing is aimed at a shape: the brief is cut and relaxed by the same rule for every person; what changed is the body it is made on.
// { refit8: { brief8: false } } is the A/B (the bake's brief carried, as before); { refit8: { brief8: { kind, gap } } } its options.
//   briefPerson8(P, o) -> report { kind, verts, loops, pushed, parts: [...], cull: { before, after }, ms }
import * as THREE from 'three';
import { SurfaceMesh, vertexNormals } from '../collide.js';
import { bodyOf, fitFoundation, foundationData, heroScale } from '../foundations.js';
import { fabric6Attributes } from '../fabric6.js';
export const BRIEF8_VERSION = 1;
export const BRIEF8_DEFAULT = { gap: 0.0011, reach: 0.03, boxersExtent: 0.24 };

// the brief among the built person's found parts: a 'shell' and what follows it up to the next shell, the one with a waist binding
export function briefParts(P) { const F = (P.parts || []).filter(m => m.userData?.k3?.group === 'found'), G = [];
  F.forEach(m => { if (m.userData.k3.name === 'shell' || !G.length) G.push({ shell: null, sewn: [] }); const g = G[G.length - 1]; if (m.userData.k3.name === 'shell') g.shell = m; else g.sewn.push(m); });
  return G.find(g => g.shell && g.sewn.some(m => m.userData.k3.name === 'binding.waist')) || null; }

// the skinning of a point from the skin under it: the closest skin triangle's corners, barycentric, the four largest bones (the cloth in
// contact rides that skin in every pose; foundationData's SRC is the body vertex the cloth was CUT from, and where the membrane moved off it
// (the gusset bridging the fork from the thighs' faces onto the perineum) that is a thigh's: in the stance the adducted thighs carried
// the gusset down into a bag again, 2-4 cm below the perineum on L12 and L22)
export function skinUnder(X, SI, SW, T, tri, px, py, pz) { const a = T[tri * 3], b = T[tri * 3 + 1], c = T[tri * 3 + 2];
  const v0 = [X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]], v1 = [X[c * 3] - X[a * 3], X[c * 3 + 1] - X[a * 3 + 1], X[c * 3 + 2] - X[a * 3 + 2]], v2 = [px - X[a * 3], py - X[a * 3 + 1], pz - X[a * 3 + 2]];
  const d = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2], d00 = d(v0, v0), d01 = d(v0, v1), d11 = d(v1, v1), d20 = d(v2, v0), d21 = d(v2, v1), den = d00 * d11 - d01 * d01 || 1e-18;
  let bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den; bv = Math.min(1, Math.max(0, bv)); bw = Math.min(1 - bv, Math.max(0, bw)); const bu = 1 - bv - bw, acc = new Map();
  for (const [v, w] of [[a, bu], [b, bv], [c, bw]]) for (let k = 0; k < 4; k++) { const wt = SW[v * 4 + k] * w; if (wt > 0) acc.set(SI[v * 4 + k], (acc.get(SI[v * 4 + k]) || 0) + wt); }
  const top = [...acc.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4), s = top.reduce((t, e) => t + e[1], 0) || 1; return top.map(e => [e[0], e[1] / s]); }
export function reskinUnder(rec, Sd, Xd, SI, SW, T, reach) { const n = rec.X.length / 3; let k = 0;
  for (let v = 0; v < n; v++) { const q = Sd.closestAny(rec.X[v * 3], rec.X[v * 3 + 1], rec.X[v * 3 + 2], reach); if (!q || q.tri < 0) continue; const w = skinUnder(Xd, SI, SW, T, q.tri, q.px, q.py, q.pz);
    for (let j = 0; j < 4; j++) { rec.SI[v * 4 + j] = w[j] ? w[j][0] : 0; rec.SW[v * 4 + j] = w[j] ? w[j][1] : 0; } k++; }
  return k; }

// the geometry partMesh2 (person/core.js) builds for a bake part, on an existing mesh (its material, skeleton binding and userData kept)
function setPartGeometry(m, rec, sc) {
  const old = m.geometry, n = rec.X.length / 3, X = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) X[i] = rec.X[i] / sc;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(X, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(rec.T), 1));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(rec.SI), 4)); const SW = Float32Array.from(rec.SW); for (let v = 0; v < n; v++) { const s = SW[v * 4] + SW[v * 4 + 1] + SW[v * 4 + 2] + SW[v * 4 + 3] || 1; for (let k = 0; k < 4; k++) SW[v * 4 + k] /= s; }
  g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4)); g.computeVertexNormals();
  if (old.attributes.uv) { const uv = Float32Array.from(rec.uv || new Float32Array(n * 2)), rest = new Float32Array(n * 3), ah = new Float32Array(n * 4); for (let i = 0; i < n; i++) { rest[i * 3] = uv[i * 2]; rest[i * 3 + 1] = uv[i * 2 + 1]; ah.set([2, 0, 1, 0], i * 4); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); if (old.attributes.aRest) g.setAttribute('aRest', new THREE.BufferAttribute(rest, 3)); if (old.attributes.aHero) g.setAttribute('aHero', new THREE.BufferAttribute(ah, 4)); if (old.attributes.aFold) g.setAttribute('aFold', new THREE.BufferAttribute(new Float32Array(n), 1));
    // the normals welded where the sweep or the cut put coincident vertices (as partMesh2)
    const N = g.attributes.normal.array, key = i => `${Math.round(X[i * 3] * 2e4)},${Math.round(X[i * 3 + 1] * 2e4)},${Math.round(X[i * 3 + 2] * 2e4)}`, grp = new Map();
    for (let i = 0; i < n; i++) { const k = key(i); if (!grp.has(k)) grp.set(k, []); grp.get(k).push(i); }
    for (const L of grp.values()) if (L.length > 1) { let x = 0, y = 0, z = 0; for (const i of L) { x += N[i * 3]; y += N[i * 3 + 1]; z += N[i * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; for (const i of L) { N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l; } }
    if (old.attributes.aWarp) { const warp = new Float32Array(n * 3), T = rec.T;
      for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2], du1 = uv[b * 2] - uv[a * 2], dv1 = uv[b * 2 + 1] - uv[a * 2 + 1], du2 = uv[c * 2] - uv[a * 2], dv2 = uv[c * 2 + 1] - uv[a * 2 + 1], det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) continue;
        for (let k = 0; k < 3; k++) { const e1 = X[b * 3 + k] - X[a * 3 + k], e2 = X[c * 3 + k] - X[a * 3 + k], d = (-du2 * e1 + du1 * e2) / det; warp[a * 3 + k] += d; warp[b * 3 + k] += d; warp[c * 3 + k] += d; } }
      for (let i = 0; i < n; i++) { const l = Math.hypot(warp[i * 3], warp[i * 3 + 1], warp[i * 3 + 2]); if (l > 0) for (let k = 0; k < 3; k++) warp[i * 3 + k] /= l; else warp[i * 3 + 1] = 1; }
      g.setAttribute('aWarp', new THREE.BufferAttribute(warp, 3)); } }
  g.userData = { ...(old.userData || {}), brief8: true };
  m.geometry = g; if (old.attributes.aF6e) { try { fabric6Attributes(m, g, m.material?.userData?.fabric6?.fabric); } catch (e) { /* the look without FABRIC6's per-vertex data */ } }
  g.computeBoundingSphere(); old.dispose?.();
}

// the core, on plain arrays (labs run it on dumps): fitFoundation on the final body's own vertices (Pb: the topology's nb vertices, metres),
// the shell pushed `gap` outside the drawn skin (Xd / Td: the full detailed surface, metres), the bindings swept (foundationData), every part
// skinned from the skin it lies on (SI / SW: the drawn body's skinning)
export function makeBrief8({ p, Pb, Xd, Td, SI, SW, kind, color = '#e9e4da', bindColor = null }, o = {}) {
  const O = { ...BRIEF8_DEFAULT, ...(o && typeof o === 'object' ? o : {}) };
  const Bd = bodyOf(p, Pb, null), Fd = fitFoundation(Bd, kind, O.fit || {});
  const Sd = new SurfaceMesh(Xd, Td, { cell: 0.015 }); let pushed = 0, pushMax = 0;
  for (let v = 0; v < Fd.X.length / 3; v++) { const q = Sd.closestAny(Fd.X[v * 3], Fd.X[v * 3 + 1], Fd.X[v * 3 + 2], O.reach); if (!q || q.edge) continue; const need = O.gap - q.d; if (need <= 0) continue;
    Fd.X[v * 3] += q.nx * need; Fd.X[v * 3 + 1] += q.ny * need; Fd.X[v * 3 + 2] += q.nz * need; pushed++; pushMax = Math.max(pushMax, need); }
  if (pushed) Fd.N = vertexNormals(Fd.X, Fd.tris);
  const hS = { body: { geometry: { attributes: { skinIndex: { array: SI }, skinWeight: { array: SW } } } } }, data = foundationData(hS, Fd, { color, bindColor });
  let reskinned = 0; if (O.reskin !== false) for (const d of data) reskinned += reskinUnder(d, Sd, Xd, SI, SW, Td, 0.05);
  return { Fd, data, pushed, pushMaxMm: +(pushMax * 1000).toFixed(2), reskinned };
}

export function briefPerson8(P, o = {}) {
  if (o === false) return { skipped: 'off' };
  const t0 = (globalThis.performance || Date).now(), O = { ...BRIEF8_DEFAULT, ...(o && typeof o === 'object' ? o : {}) }, h = P.h, gb = h?.body?.geometry, S = P.p?._S;
  if (!gb || !S) return { skipped: 'no body or no studio topology' };
  const B = briefParts(P); if (!B) return { skipped: 'no brief' };
  const sc = heroScale(h) || 1, nb = S.nb, BP = gb.attributes.position.array; if (BP.length < nb * 3) return { skipped: 'the body has fewer vertices than its topology' };
  // the kind the bake wore: by sex, and a boxer brief by its leg (it reaches ~12 cm below the crotch: the shell's height > boxersExtent)
  let kind = O.kind; if (!kind) { const sX = B.shell.geometry.attributes.position.array; let lo = Infinity, hi = -Infinity; for (let i = 1; i < sX.length; i += 3) { lo = Math.min(lo, sX[i]); hi = Math.max(hi, sX[i]); }
    kind = P.p.sex === 'f' ? 'briefs' : (hi - lo) * sc > O.boxersExtent ? 'boxers.m' : 'briefs.m'; }
  // (1) + (2): the brief made on the final body (bind, metres)
  const Pb = new Float64Array(nb * 3); for (let i = 0; i < nb * 3; i++) Pb[i] = BP[i] * sc;
  const Tfull = Int32Array.from(P.bodyIndexFull?.array ?? P.bodyIndexFull ?? gb.userData.plan?.tri ?? gb.index.array), Xd = new Float64Array(BP.length); for (let i = 0; i < BP.length; i++) Xd[i] = BP[i] * sc;
  const col = B.shell.userData.k3.color || '#e9e4da', bcol = B.sewn[0]?.userData?.k3?.color || null;
  const M = makeBrief8({ p: P.p, Pb, Xd, Td: Tfull, SI: gb.attributes.skinIndex.array, SW: gb.attributes.skinWeight.array, kind, color: col, bindColor: bcol && bcol !== col ? bcol : null }, O), Fd = M.Fd, data = M.data;
  // (3) the bake's meshes take the new geometry, in order: shell, then each binding (a binding the new fit lacks is dropped; one more is added)
  const old = [B.shell, ...B.sewn], parts = [];
  for (let i = 0; i < data.length; i++) { const d = data[i]; let m = old.find(q => !q.userData.brief8used && q.userData.k3.name === d.name);
    if (!m) { const tmpl = old.find(q => /^binding\./.test(q.userData.k3.name)) || B.shell; m = tmpl.clone(); m.geometry = tmpl.geometry.clone(); m.userData = { ...tmpl.userData, k3: { ...tmpl.userData.k3, name: d.name } }; m.bind?.(h.skeleton, tmpl.bindMatrix); tmpl.parent?.add(m); const at = P.parts.indexOf(old[old.length - 1]); P.parts.splice(at + 1, 0, m); old.push(m); }
    m.userData.brief8used = true; setPartGeometry(m, d, sc); parts.push(`${d.name}(${d.X.length / 3})`); }
  for (const m of old) { if (m.userData.brief8used) { delete m.userData.brief8used; continue; } m.removeFromParent(); const k = P.parts.indexOf(m); if (k >= 0) P.parts.splice(k, 1); m.geometry.dispose?.(); parts.push(`-${m.userData.k3.name}`); }
  // (4) the figure study: the skin culled under the brief = the skin the new brief covers (below the brief's top; the bra's cull untouched)
  let cull = null; const dressed = P.stages?.has?.('stack'), ix = gb.index;
  if (!dressed && ix && Tfull.length && O.cull !== false) { const L = gb.userData.subdiv?.levels || 0, k4 = 4 ** L, nt = Tfull.length / 3;
    if (nt === S.tri.length / 3 * k4) { let yTop = -Infinity; for (let v = 0; v < Fd.X.length / 3; v++) yTop = Math.max(yTop, Fd.X[v * 3 + 1]); yTop += 0.02;
      const drawn = new Uint8Array(nt), I = ix.array, key = new Map(); for (let t = 0; t < nt; t++) key.set(Tfull[t * 3] + ':' + Tfull[t * 3 + 1] + ':' + Tfull[t * 3 + 2], t);
      for (let t = 0; t < ix.count; t += 3) { const j = key.get(I[t] + ':' + I[t + 1] + ':' + I[t + 2]); if (j != null) drawn[j] = 1; }
      const before = nt - drawn.reduce((s, x) => s + x, 0); let changed = 0;
      for (let t = 0; t < nt; t++) { const pt = Math.floor(t / k4), a = S.tri[pt * 3], b = S.tri[pt * 3 + 1], c = S.tri[pt * 3 + 2]; if ((Pb[a * 3 + 1] + Pb[b * 3 + 1] + Pb[c * 3 + 1]) / 3 > yTop) continue;
        const under = Fd.cover[a] && Fd.cover[b] && Fd.cover[c] ? 1 : 0; if (drawn[t] === 1 - under) continue; drawn[t] = 1 - under; changed++; }
      if (changed) { const J = []; for (let t = 0; t < nt; t++) if (drawn[t]) J.push(Tfull[t * 3], Tfull[t * 3 + 1], Tfull[t * 3 + 2]); gb.setIndex(new THREE.BufferAttribute(I instanceof Uint16Array && Tfull.length < 65536 ? Uint16Array.from(J) : Uint32Array.from(J), 1)); }
      cull = { before, after: nt - drawn.reduce((s, x) => s + x, 0), changed }; }
    else cull = { skipped: 'the drawn index is not the topology at its subdivision level' }; }
  return { version: BRIEF8_VERSION, kind, verts: Fd.X.length / 3, loops: Fd.loops.length, lift: Fd.report.liftMaxMm, pushed: M.pushed, pushMaxMm: M.pushMaxMm, reskinned: M.reskinned, parts, cull, ms: Math.round((globalThis.performance || Date).now() - t0) };
}
