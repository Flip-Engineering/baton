// DRAPE (CLOTHING c1): garments settled by gravity on the posed body, written back as their bind-space shape so they render through
// the ordinary skinned path. Opt-in: nothing runs unless drapeHero(h) is called (labs/clothing1/lab_cloth.html &drape=1); a figure
// that is never draped renders exactly as before. Pure JS on typed arrays; the same result in node and the browser.
//
//   drapeHero(h, opts)   for each garment of a hero (h.cloth), from the inside out (a shirt, then trousers; for a coat or a shirt worn
//                        out: trousers, the top, its skirt; then a vest). A coverall is ONE cloth: its top and bottom shells are built
//                        from the same body vertices over the waist band, so they are merged there into one particle system and solved
//                        together (no hem at the waist; the bottom shell is written 1.5 mm outside the top where both are drawn).
//     1. a PATTERN: the rest shape the cloth is cut to, in bind space. Each shell vertex is a body vertex pushed out; the pattern starts
//        on that skin + a gap (the trunk of a top starts on hero.js's own shell instead, which already spans under a bust: from the skin,
//        a deep fold under a heavy breast is an undercut the flow cannot fill) and is shrink-wrapped: normal-only Laplacian smoothing (mean-curvature flow: no tangential drift, so the
//        cuts on aHero stay put) held outside the skin, 40 passes. That bridges every hollow narrower than ~10 cm (between the breasts,
//        the navel, the spine, under the bust, the back of the knee) and, with the keep-out lowered by the skin's prominence over its
//        own ~4 cm average (at most 1.5 mm, well under the 4.5 mm gap, so the true skin never comes through: hero.js does not hide all the skin under a garment), rounds over small convex bumps (a nipple, a breast's cone tip, the navel's rim): the anatomy
//        leaves the cloth's own metric. Then the cut: ease as an offset along the smoothed normal (a convex section grows by 2 pi d in
//        girth, d = ease / 2 pi: work shirt ~12 cm at the chest and 14 at the waist, chore coat 16-20, tee 5-7, coverall 14-18 and 12 at
//        the seat, work trousers 8 at the seat and thigh, jeans 5); "straight cut" (each section no narrower than the one above it, per
//        10-degree sector round the body or limb axis: a top from the chest down, a trouser leg from the upper thigh with the trousers'
//        own straightness and fully from the knee down: the c6 hang rule, now in the pattern); length (a tucked shirt ~3.5 cm longer than
//        the back it covers, so it blouses; a coverall's crotch drops ~5 cm; a coat sleeve ~2.5 cm past the wrist); a few more passes.
//     2. PINS where the garment is held: a top's shoulder yoke and collar (no ease there), the waistband of trousers (over a tucked
//        shirt's tail), the top rings of a coat skirt, a vest's shoulders: hard pins at the pattern's posed place pushed out of the skin.
//        A tucked tail (snug on the body, inside the trousers), a rolled sleeve and a coverall's buttoned cuff are soft pins (XPBD
//        attachments). Parts of a shell's superset far past its cut that nothing holds (a top's strip into the crotch) stay as they were.
//     3. a SOLVE in the posed space (xpbd.js: XPBD stretch, dihedral bending from KES B with flat panels as the rest state, long-range
//        attachments, contacts and friction against the posed body (its small bumps pressed in, as above) and the layers already draped
//        under it (collide.js), cheap self-repulsion), 0.8 s of settling at 900 substeps a second, gravity in the hero's frame.
//     4. WRITE-BACK: each vertex's draped posed position x goes back to bind space through the inverse of its own blended skinning
//        matrix, b = (sum w_i M_i)^-1 x (exact for linear blend skinning in this pose): in this pose the garment renders where the solve
//        left it. Normals by the HUMAN c7 rule (triangles wound away from the body, vertex normals on the body's outward side). Parts
//        made on a shell (rims, collar, pockets, the coat skirt's join) move with the nearest shell vertices (inverse-distance weights of
//        the 4 nearest, in the undraped bind space).
//     5. the CONTRACT with the fabric shader: attribute aRest (vec3, the undraped bind position: the material coordinate, so weave and
//        wear stay on the cloth) with material.defines.CLOTH_REST = 1; attribute aFold (float: fold-scale signed mean curvature, i.e. the
//        curvature minus its own ~6 cm average so a sleeve's roundness is not a "crest", times the fabric's Peirce bending length c;
//        > 0 crest, < 0 valley) with CLOTH_FOLD = 1; material.needsUpdate. Rims, collar and pockets get aRest only.
//   Idempotent: the undraped shape lives in geometry.userData.drapeRest and is restored before every drape.
//   Bakes: before solving, drapeHero looks for assets/cloth/bakes/<variant>-<hash>.bin (hash of the variant, the fabric map, every
//   bone's rounded local transform, gravity in the hero frame, each garment's rest-shape checksum, XPBD_VERSION and DRAPE_VERSION):
//   per mesh the draped bind displacement quantized to 0.05 mm (int16) and aFold (int8). labs/clothing1/drape_bake.mjs writes them
//   for the CREW8 line-up in their idleStance poses. A bake is one pose: a hero in another pose solves live (a few seconds).
// Fabric per garment: h.fabrics[key] (set under o.cloth), else the trade default from h.o (the same table as wardrobe.js: work shirt
// chambray, flannel, tee jersey, chore coat duck, leather, coverall poly-cotton twill; trousers by trouserKind 0 twill, 1 flannel,
// 2 denim, 3 duck, 4 leather, 5 knit; vest hi-vis knit), so drape=1 works with cloth=0.
// Refs: Macklin, Mueller, Chentanez, "XPBD" (MIG 2016); Kim, Chentanez, Mueller, "Long Range Attachments" (SCA 2012); Bridson, Marino,
// Fedkiw, "Simulation of clothing with folds and wrinkles" (SCA 2003); Desbrun, Meyer, Schroeder, Barr, "Implicit fairing of irregular
// meshes using diffusion and curvature flow" (1999) for the normal-only smoothing; Peirce, "The handle of cloth as a measurable
// quantity" (1930) for c; the pressed-in bump is garment.js drapeShell's (HUMAN c7).
import { Cloth, XPBD_VERSION } from './xpbd.js';
import { SurfaceMesh, Contacts, boneMats, skinPose, blendInverse, vertexNormals } from './collide.js';
import { FABRICS, phys } from './fabrics.js';
export const DRAPE_VERSION = 5;
// (CLOTHING c2: the helpers below are exported for lib/fx/cloth/stack.js; drapeHero itself is unchanged)
export const RG = { head: 0, neck: 1, torso: 2, uarm: 3, farm: 4, hand: 5, finger: 6, pelvis: 7, thigh: 8, shin: 9, foot: 10, jaw: 11 };
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const now = () => (globalThis.performance ? performance.now() : Date.now());
const TAU = Math.PI * 2, list = x => [].concat(x || []).filter(Boolean);
export const SQUASH = 0.0015, GAP_SKIN = 0.0045;   // bumps pressed in by at most 1.5 mm; the cloth held 4.5 mm + half its thickness off the skin
export const isArm = r => r === RG.uarm || r === RG.farm || r === RG.hand, isLeg = r => r === RG.thigh || r === RG.shin || r === RG.foot, isTrunk = r => r === RG.torso || r === RG.pelvis || r === RG.neck;

// ---------------------------------------------------------------- fabrics and cuts
const TOP_FAB = { work: 'chambray', flannel: 'flannel', tee: 'jersey', coat: 'duck', leather: 'leather', coverall: 'twillPC' }, TROUSER_FAB = ['twillPC', 'flannel', 'denim', 'duck', 'leather', 'jersey'];
export function fabricFor(h, key) {
  const f = h.fabrics && h.fabrics[key], ok = x => typeof x === 'string' && FABRICS[x]; if (ok(f)) return f; if (Array.isArray(f) && ok(f[0])) return f[0];
  const o = h.o || {};
  if (key === 'bottom') return o.kind === 'coverall' ? 'twillPC' : TROUSER_FAB[o.trouserKind ?? 2] || 'denim';
  if (key === 'vest') return 'hivisMesh';
  return TOP_FAB[o.kind] || 'chambray';
}
// girth ease (m) of a top: chest, waist, upper arm, forearm; len = extra length below the chest (tucked: it blouses), slv = extra
// sleeve length at the cuff, straight = how far the trunk keeps the chest's section down to the hem (1 = a straight cut)
export const TOP_CUT = {
  work:     { chest: 0.12, waist: 0.14, uarm: 0.08, farm: 0.07, len: 0.035, slv: 0, straight: 1 },
  flannel:  { chest: 0.12, waist: 0.14, uarm: 0.08, farm: 0.07, len: 0.035, slv: 0, straight: 1 },
  tee:      { chest: 0.05, waist: 0.07, uarm: 0.05, farm: 0.05, len: 0, slv: 0, straight: 0.7 },
  coat:     { chest: 0.16, waist: 0.2, uarm: 0.1, farm: 0.09, len: 0, slv: 0.025, straight: 1 },
  leather:  { chest: 0.1, waist: 0.12, uarm: 0.07, farm: 0.06, len: 0, slv: 0.02, straight: 1 },
  coverall: { chest: 0.1, waist: 0.12, uarm: 0.09, farm: 0.08, len: 0.02, slv: 0.02, straight: 0.8 },
};
// trousers by fabric (jeans sit closer than duck or twill work trousers); a coverall's legs are fuller and its crotch drops
export const LEG_CUT = { denim: { seat: 0.05, thigh: 0.05, knee: 0.06, straight: 0.6, len: 0.01, drop: 0 }, work: { seat: 0.08, thigh: 0.08, knee: 0.08, straight: 0.85, len: 0.012, drop: 0.015 },
  coverall: { seat: 0.12, thigh: 0.1, knee: 0.09, straight: 0.9, len: 0.01, drop: 0.04 } };
export const KNIT = new Set(['jersey', 'rib', 'hivisMesh', 'hivisYG', 'hivisOR']);

// ---------------------------------------------------------------- the hero's frame, body and bones in this pose
export function context(h, { positions = null } = {}) {   // positions (K3, opt-in): bind positions to collide with instead of the body's own (the body over its foundations)
  const body = h.body, g = body.geometry; h.group.updateMatrixWorld(true);
  const e = body.matrixWorld.elements, S = Math.cbrt(Math.abs(e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2])));
  const grav = [-9.81 * e[1] / S, -9.81 * e[5] / S, -9.81 * e[9] / S];   // R^T (0, -g, 0), R = the world rotation (columns / S)
  const M = boneMats(h.skeleton, body.matrixWorld);
  const BP = positions || g.attributes.position.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = BP.length / 3;
  const { pid, rep, np } = weld(BP), tris = remapTris(g.index.array, pid);
  const bind = new Float64Array(np * 3), posedAll = skinPose(BP, SI, SW, M, new Float64Array(n * 3), S), posed = new Float64Array(np * 3);
  for (let p = 0; p < np; p++) { const v = rep[p]; for (let c = 0; c < 3; c++) { bind[p * 3 + c] = BP[v * 3 + c] * S; posed[p * 3 + c] = posedAll[v * 3 + c]; } }
  const N0 = g.attributes.normal.array, Nb = vertexNormals(bind, tris); let dot = 0; for (let p = 0; p < np; p += 7) { const v = rep[p]; dot += Nb[p * 3] * N0[v * 3] + Nb[p * 3 + 1] * N0[v * 3 + 1] + Nb[p * 3 + 2] * N0[v * 3 + 2]; }
  if (dot < 0) { for (let t = 0; t < tris.length; t += 3) { const b = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = b; } vertexNormals(bind, tris, Nb); }
  // the collision body: small convex bumps pressed in (soft tissue under cloth in tension: garment.js drapeShell's rule), by the
  // skin's prominence over its own ~4 cm average (8 Laplacian passes on the bind mesh), at most SQUASH (1.5 mm, well under the contact
  // gap: hero.js does not hide all of the skin under a garment, and a nipple or a hip bone pressed through the cloth showed)
  const nb = neighbours(tris, np); let RS = Float64Array.from(bind);
  for (let it = 0; it < 8; it++) { const Y = new Float64Array(RS); for (let p = 0; p < np; p++) { const L = nb[p]; if (!L.length) continue; let sx = 0, sy = 0, sz = 0; for (let j = 0; j < L.length; j++) { const u = L[j]; sx += RS[u * 3]; sy += RS[u * 3 + 1]; sz += RS[u * 3 + 2]; }
      Y[p * 3] += 0.5 * (sx / L.length - RS[p * 3]); Y[p * 3 + 1] += 0.5 * (sy / L.length - RS[p * 3 + 1]); Y[p * 3 + 2] += 0.5 * (sz / L.length - RS[p * 3 + 2]); } RS = Y; }
  const Np = vertexNormals(posed, tris), squashed = Float64Array.from(posed);
  for (let p = 0; p < np; p++) { const pr = clamp((bind[p * 3] - RS[p * 3]) * Nb[p * 3] + (bind[p * 3 + 1] - RS[p * 3 + 1]) * Nb[p * 3 + 1] + (bind[p * 3 + 2] - RS[p * 3 + 2]) * Nb[p * 3 + 2], 0, SQUASH);
    for (let c = 0; c < 3; c++) squashed[p * 3 + c] -= Np[p * 3 + c] * pr; }
  const bodyBind = new SurfaceMesh(bind, tris, { cell: 0.03, normals: Nb }), bodyPosed = new SurfaceMesh(squashed, tris, { cell: 0.03 });
  // the body the EASE is measured from: the same 8 Laplacian passes (detail under ~4 cm gone: a nipple, the navel, the cone of a breast's
  // apex rounded), so the cut is an offset of the body's masses, not of its small bumps (an offset surface keeps every bump as a knob)
  const bodySoft = new SurfaceMesh(RS, tris, { cell: 0.03, normals: vertexNormals(RS, tris) });
  const I = h.idx, J = k => { const v = h.head0[I[k]]; return [v.x * S, v.y * S, v.z * S]; };
  const H = h.hems || {}, hem = k => (H[k] ?? 0) * S;
  const zMid = y => { let z0 = Infinity, z1 = -Infinity; for (let p = 0; p < np; p++) if (Math.abs(bind[p * 3 + 1] - y) < 0.01 && Math.abs(bind[p * 3]) < 0.12) { z0 = Math.min(z0, bind[p * 3 + 2]); z1 = Math.max(z1, bind[p * 3 + 2]); } return z0 < z1 ? (z0 + z1) / 2 : 0; };
  return { S, M, grav, bodyBind, bodyPosed, bodySoft, J, hem, H, zMid };
}
// merge vertices that share a position (the body splits along UV and region seams)
export function weld(P, tol = 1e-5) {
  const n = P.length / 3, map = new Map(), pid = new Int32Array(n), rep = [], q = 1 / tol;
  for (let v = 0; v < n; v++) { const k = `${Math.round(P[v * 3] * q)},${Math.round(P[v * 3 + 1] * q)},${Math.round(P[v * 3 + 2] * q)}`; let p = map.get(k); if (p == null) { p = rep.length; rep.push(v); map.set(k, p); } pid[v] = p; }
  return { pid, rep: Int32Array.from(rep), np: rep.length };
}
export function remapTris(idx, pid, seen = null) { const T = []; for (let t = 0; t < idx.length; t += 3) { const a = pid[idx[t]], b = pid[idx[t + 1]], c = pid[idx[t + 2]]; if (a === b || b === c || a === c) continue;
  if (seen) { const s = [a, b, c].sort((x, y) => x - y).join(','); if (seen.has(s)) continue; seen.add(s); } T.push(a, b, c); } return Int32Array.from(T); }
export function neighbours(tris, n) { const nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); } return nb.map(s => Int32Array.from(s)); }

// ---------------------------------------------------------------- rest shapes kept on the geometry (idempotence)
export function keepRest(m) { const g = m.geometry; if (!g.userData.drapeRest) g.userData.drapeRest = { position: Float32Array.from(g.attributes.position.array), normal: g.attributes.normal ? Float32Array.from(g.attributes.normal.array) : null, index: g.index ? Uint32Array.from(g.index.array) : null }; return g.userData.drapeRest; }
export function restore(m) { const g = m.geometry, R = g.userData.drapeRest; if (!R) return; g.attributes.position.array.set(R.position); g.attributes.position.needsUpdate = true;
  if (R.index && g.index) { g.index.array.set(R.index); g.index.needsUpdate = true; } if (R.normal && g.attributes.normal) { g.attributes.normal.array.set(R.normal); g.attributes.normal.needsUpdate = true; } }

// ---------------------------------------------------------------- particles: one or more shells as one cloth
// the body vertex each shell vertex was made from: hero.js copies a body vertex's uv and skinning onto its shell vertex
export function bodyIds(h, m) {
  const B = h.body.geometry, BU = B.attributes.uv.array, BI = B.attributes.skinIndex.array, BW = B.attributes.skinWeight.array, n0 = BU.length / 2;
  const key = (U, Ii, Ww, k) => `${U[k * 2].toFixed(5)},${U[k * 2 + 1].toFixed(5)},${Ii[k * 4]},${Ii[k * 4 + 1]},${Ii[k * 4 + 2]},${Ww[k * 4].toFixed(4)},${Ww[k * 4 + 1].toFixed(4)}`;
  const map = h._drapeSkinKey || (h._drapeSkinKey = (() => { const mp = new Map(); for (let v = 0; v < n0; v++) { const k = key(BU, BI, BW, v); if (!mp.has(k)) mp.set(k, v); } return mp; })());
  const g = m.geometry, U = g.attributes.uv?.array, n = g.attributes.position.count, out = new Int32Array(n).fill(-1); if (!U) return out;
  const Ii = g.attributes.skinIndex.array, Ww = g.attributes.skinWeight.array; for (let v = 0; v < n; v++) { const b = map.get(key(U, Ii, Ww, v)); if (b != null) out[v] = b; } return out;
}
// ms: shells (merged where they share body vertices when byBody), offs: outward offset per shell where a particle is shared (m)
export function particlesOf(h, ms, S, { byBody = false, offs = null } = {}) {
  const map = new Map(), repM = [], repV = [], meshes = [], seen = new Set(), T = [];
  ms.forEach((m, mi) => { const R = keepRest(m), pos = R.position, n = pos.length / 3, ids = byBody ? bodyIds(h, m) : null, pid = new Int32Array(n), q = 1e5;
    for (let v = 0; v < n; v++) { const k = ids && ids[v] >= 0 ? `b${ids[v]}` : `${mi}:${Math.round(pos[v * 3] * q)},${Math.round(pos[v * 3 + 1] * q)},${Math.round(pos[v * 3 + 2] * q)}`;
      let p = map.get(k); if (p == null) { p = repM.length; repM.push(mi); repV.push(v); map.set(k, p); } pid[v] = p; }
    for (const t of remapTris(R.index || m.geometry.index.array, pid, seen)) T.push(t);
    meshes.push({ m, pid, ids, off: offs ? offs[mi] : 0 }); });
  const np = repM.length, Xb = new Float64Array(np * 3), AH = new Float64Array(np * 4), SI = new Uint16Array(np * 4), SW = new Float32Array(np * 4), owner = new Uint8Array(np);
  for (const [mi, { pid }] of meshes.entries()) for (let v = 0; v < pid.length; v++) owner[pid[v]] |= 1 << mi;
  for (let p = 0; p < np; p++) { const g = ms[repM[p]].geometry, v = repV[p], pos = g.userData.drapeRest.position, A = g.attributes.aHero.array, I = g.attributes.skinIndex.array, W = g.attributes.skinWeight.array;
    for (let c = 0; c < 3; c++) Xb[p * 3 + c] = pos[v * 3 + c] * S; for (let c = 0; c < 4; c++) { AH[p * 4 + c] = A[v * 4 + c]; SI[p * 4 + c] = I[v * 4 + c]; SW[p * 4 + c] = W[v * 4 + c]; } }
  const tris = Int32Array.from(T), G = { meshes, np, tris, Xb, AH, SI, SW, owner, nb: neighbours(tris, np), src: null };
  if (byBody) { const BP = h.body.geometry.attributes.position.array, BN = h.body.geometry.attributes.normal.array, src = new Float64Array(np * 6); let miss = 0;
    for (let p = 0; p < np; p++) { const b = meshes[repM[p]].ids[repV[p]]; if (b < 0) { miss++; continue; } for (let c = 0; c < 3; c++) { src[p * 6 + c] = BP[b * 3 + c] * S; src[p * 6 + 3 + c] = BN[b * 3 + c]; } }
    if (miss < np * 0.02) { if (miss) fillMissing(src, G); G.src = src; } }
  return G;
}
function fillMissing(out, G) { const has = p => out[p * 6 + 3] || out[p * 6 + 4] || out[p * 6 + 5]; for (let it = 0; it < 20; it++) { let left = 0; for (let p = 0; p < G.np; p++) { if (has(p)) continue; let u = -1; for (const w of G.nb[p]) if (has(w)) { u = w; break; } if (u < 0) { left++; continue; } for (let c = 0; c < 6; c++) out[p * 6 + c] = out[u * 6 + c]; } if (!left) break; } }

// ---------------------------------------------------------------- the pattern
// cut: { keep: SurfaceMesh (bind, metres: what the pattern may not go inside), gap, ease(p, region, along, x, y, z) -> girth ease m,
//        straight: [straighten specs], lengthen(P, AH), after(P), wrap (passes), squash (m) }
export function pattern(ctx, G, cut) {
  const { Xb, tris, nb, AH } = G, np = Xb.length / 3, keep = cut.keep, gap = cut.gap, P = new Float64Array(np * 3), hints = new Int32Array(np).fill(-1);
  // 1. start on the skin (or the layer under) + gap
  for (let p = 0; p < np; p++) { if (G.src && !(cut.fromShell && cut.fromShell(p, AH[p * 4], Xb[p * 3 + 1]))) { for (let c = 0; c < 3; c++) P[p * 3 + c] = G.src[p * 6 + c] + G.src[p * 6 + 3 + c] * gap; continue; }
    if (G.src) { for (let c = 0; c < 3; c++) P[p * 3 + c] = Xb[p * 3 + c]; continue; }
    const q = keep.closest(Xb[p * 3], Xb[p * 3 + 1], Xb[p * 3 + 2], 0.25); if (q) { hints[p] = keep.lastV; P[p * 3] = q.px + q.nx * gap; P[p * 3 + 1] = q.py + q.ny * gap; P[p * 3 + 2] = q.pz + q.nz * gap; } else for (let c = 0; c < 3; c++) P[p * 3 + c] = Xb[p * 3 + c]; }
  // with cut.soft (the smoothed body): the offset (gap, ease) is held from the soft body, and the true skin only keeps out by cut.hard
  const soft = cut.soft || null, hintsS = new Int32Array(np).fill(-1);
  const hold = (minOff) => { for (let p = 0; p < np; p++) { const q = keep.closest(P[p * 3], P[p * 3 + 1], P[p * 3 + 2], 0.12, hints[p]); hints[p] = keep.lastV; const need = soft ? Math.min(cut.hard, minOff[p]) : minOff[p];
    if (q && q.d < need) { const k = need - q.d; P[p * 3] += q.nx * k; P[p * 3 + 1] += q.ny * k; P[p * 3 + 2] += q.nz * k; }
    if (!soft) continue; const r = soft.closest(P[p * 3], P[p * 3 + 1], P[p * 3 + 2], 0.12, hintsS[p]); hintsS[p] = soft.lastV;
    if (r && r.d < minOff[p]) { const k = minOff[p] - r.d; P[p * 3] += r.nx * k; P[p * 3 + 1] += r.ny * k; P[p * 3 + 2] += r.nz * k; } } };
  const flow = (its, minOff, lam = 0.5) => { const Nn = new Float64Array(np * 3), D = new Float64Array(np); for (let it = 0; it < its; it++) { vertexNormals(P, tris, Nn);
      for (let p = 0; p < np; p++) { const L = nb[p]; if (!L.length) { D[p] = 0; continue; } let sx = 0, sy = 0, sz = 0; for (let j = 0; j < L.length; j++) { const u = L[j]; sx += P[u * 3]; sy += P[u * 3 + 1]; sz += P[u * 3 + 2]; }
        D[p] = (sx / L.length - P[p * 3]) * Nn[p * 3] + (sy / L.length - P[p * 3 + 1]) * Nn[p * 3 + 1] + (sz / L.length - P[p * 3 + 2]) * Nn[p * 3 + 2]; }
      for (let p = 0; p < np; p++) { P[p * 3] += lam * D[p] * Nn[p * 3]; P[p * 3 + 1] += lam * D[p] * Nn[p * 3 + 1]; P[p * 3 + 2] += lam * D[p] * Nn[p * 3 + 2]; }
      hold(minOff); } };
  // small convex bumps: the keep-out is lowered by the skin's prominence over its own few-cm average (at most cut.squash)
  const base = new Float64Array(np).fill(gap);
  if (G.src) { let RS = new Float64Array(np * 3); for (let p = 0; p < np; p++) for (let c = 0; c < 3; c++) RS[p * 3 + c] = G.src[p * 6 + c];
    for (let it = 0; it < 8; it++) { const Y = new Float64Array(RS); for (let p = 0; p < np; p++) { const L = nb[p]; if (!L.length) continue; let sx = 0, sy = 0, sz = 0; for (let j = 0; j < L.length; j++) { const u = L[j]; sx += RS[u * 3]; sy += RS[u * 3 + 1]; sz += RS[u * 3 + 2]; }
        Y[p * 3] += 0.5 * (sx / L.length - RS[p * 3]); Y[p * 3 + 1] += 0.5 * (sy / L.length - RS[p * 3 + 1]); Y[p * 3 + 2] += 0.5 * (sz / L.length - RS[p * 3 + 2]); } RS = Y; }
    for (let p = 0; p < np; p++) { const pr = (G.src[p * 6] - RS[p * 3]) * G.src[p * 6 + 3] + (G.src[p * 6 + 1] - RS[p * 3 + 1]) * G.src[p * 6 + 4] + (G.src[p * 6 + 2] - RS[p * 3 + 2]) * G.src[p * 6 + 5]; base[p] = gap - clamp(pr, 0, cut.squash ?? SQUASH); } }
  hold(base); flow(cut.wrap ?? 40, base);
  // 2. ease per particle (as a radius), smoothed over the mesh (region seams)
  const E = new Float64Array(np); for (let p = 0; p < np; p++) E[p] = cut.ease(p, AH[p * 4], AH[p * 4 + 1], Xb[p * 3], Xb[p * 3 + 1], Xb[p * 3 + 2]) / TAU;
  for (let it = 0; it < 6; it++) { const E2 = new Float64Array(E); for (let p = 0; p < np; p++) { const L = nb[p]; let s = E[p]; for (let j = 0; j < L.length; j++) s += E[L[j]]; E2[p] = s / (L.length + 1); } E.set(E2); }
  // 3. straight cut, 4. ease along the smoothed normal, 5. length and the crotch, 6. settle the cut (held at the gap + most of the ease)
  for (const st of cut.straight || []) st.curtain ? curtain(P, st) : straighten(P, st);
  { const Nn = vertexNormals(P, tris); for (let p = 0; p < np; p++) for (let c = 0; c < 3; c++) P[p * 3 + c] += Nn[p * 3 + c] * E[p]; }
  if (cut.lengthen) cut.lengthen(P, AH);
  const minOff = new Float64Array(np); for (let p = 0; p < np; p++) minOff[p] = base[p] + 0.75 * E[p];
  flow(cut.fair ?? 6, minOff, 0.4);
  // where the garment is held (the yoke and neckline of a top, a waistband) the pattern IS the shell: hero.js cuts the neckline and the
  // waist on the bind position (vBind), so the cloth there must keep its bind place for the cut, the collar and the belt to stay put
  if (cut.shell) for (let p = 0; p < np; p++) { const w = cut.shell(p, AH[p * 4], AH[p * 4 + 1], Xb[p * 3 + 1]); if (w > 0) for (let c = 0; c < 3; c++) P[p * 3 + c] += (Xb[p * 3 + c] - P[p * 3 + c]) * w; }
  if (cut.after) cut.after(P);
  return { P, E };
}
// st: { sel: Uint8Array(np), o: [3], d: [3] (unit axis), e: [3] (unit lateral), from: t (m along the axis), ramp (m over which k comes in), fade: [t0, t1] (k goes
//       out again), bin, k (0..1), top (t past which nothing is touched), tent (span hollows along the axis), spread (angular blur, sectors) }
export function straighten(P, st) {
  const np = P.length / 3, { sel, o, d, e } = st, f = [d[1] * e[2] - d[2] * e[1], d[2] * e[0] - d[0] * e[2], d[0] * e[1] - d[1] * e[0]], NS = 36, bin = st.bin || 0.02, tTop = st.top ?? Infinity;
  const T = new Float64Array(np), A = new Int32Array(np), Rr = new Float64Array(np); let tmin = Infinity, tmax = -Infinity;
  for (let p = 0; p < np; p++) { if (!sel[p]) continue; const x = P[p * 3] - o[0], y = P[p * 3 + 1] - o[1], z = P[p * 3 + 2] - o[2], t = x * d[0] + y * d[1] + z * d[2];
    const u = x * e[0] + y * e[1] + z * e[2], v = x * f[0] + y * f[1] + z * f[2]; T[p] = t; Rr[p] = Math.hypot(u, v); A[p] = ((Math.floor((Math.atan2(v, u) / TAU + 1) * NS) % NS) + NS) % NS; tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
  if (!(tmax > tmin)) return; const nbins = Math.ceil((tmax - tmin) / bin) + 1, R = new Float64Array(nbins * NS);
  for (let p = 0; p < np; p++) if (sel[p]) { const b = Math.floor((T[p] - tmin) / bin); R[b * NS + A[p]] = Math.max(R[b * NS + A[p]], Rr[p]); }
  // a sector's max over its neighbours (sparse bins), then a smooth angular blur: a drop from one high point (a breast's apex, a knee)
  // becomes a curtain over the neighbouring sectors instead of a narrow column (which folded in under it as a dark notch)
  const aw = st.spread ?? 2, R2 = new Float64Array(R.length);
  for (let b = 0; b < nbins; b++) for (let s = 0; s < NS; s++) { let m = 0; for (let k = -1; k <= 1; k++) m = Math.max(m, R[b * NS + (s + k + NS) % NS]); R2[b * NS + s] = m; }
  if (aw > 0) for (let b = 0; b < nbins; b++) { const row = R2.slice(b * NS, b * NS + NS); for (let s = 0; s < NS; s++) { if (!row[s]) continue; let sw = 0, sv = 0, mx = 0;
      for (let k = -aw * 2; k <= aw * 2; k++) { const v = row[(s + k + NS) % NS]; if (!v) continue; const w = Math.exp(-0.5 * (k / aw) ** 2); sw += w; sv += w * v; mx = Math.max(mx, v); } R2[b * NS + s] = Math.max(row[s], 0.5 * (sv / sw) + 0.5 * mx); } }
  // the tent (st.tent): per sector, the upper concave hull of the section radius along the axis, so the cloth spans straight from one
  // high point to the next (collarbones to the bust's apex) instead of following the hollow between them (drapeShell's profile, c7)
  if (st.tent) for (let s = 0; s < NS; s++) { const pts = []; for (let b = 0; b < nbins; b++) if (R2[b * NS + s] > 0) pts.push([b, R2[b * NS + s]]); if (pts.length < 3) continue;
    const H = []; for (const q of pts) { while (H.length >= 2) { const a = H[H.length - 2], c = H[H.length - 1]; if ((c[0] - a[0]) * (q[1] - a[1]) - (c[1] - a[1]) * (q[0] - a[0]) >= 0) H.pop(); else break; } H.push(q); }
    for (let j = 0; j < H.length - 1; j++) { const [b1, r1] = H[j], [b2, r2] = H[j + 1]; for (let b = b1 + 1; b < b2; b++) if (R2[b * NS + s] > 0) R2[b * NS + s] = Math.max(R2[b * NS + s], r1 + (r2 - r1) * (b - b1) / (b2 - b1)); } }
  const b0 = clamp(Math.floor((st.from - tmin) / bin), 0, nbins - 1); for (let b = b0 + 1; b < nbins; b++) for (let s = 0; s < NS; s++) R2[b * NS + s] = Math.max(R2[b * NS + s], R2[(b - 1) * NS + s]);
  for (let p = 0; p < np; p++) { if (!sel[p] || T[p] > tTop) continue; const b = Math.floor((T[p] - tmin) / bin); if ((b <= b0 && !st.tent) || Rr[p] < 0.02) continue;
    const r1 = Rr[p] + (R2[b * NS + A[p]] - Rr[p]) * (b <= b0 ? 1 : st.k * (st.ramp ? sstep(st.from, st.from + st.ramp, T[p]) : 1) * (st.fade ? 1 - sstep(st.fade[0], st.fade[1], T[p]) : 1)); if (r1 <= Rr[p]) continue;
    const s = r1 / Rr[p], x = P[p * 3] - o[0], y = P[p * 3 + 1] - o[1], z = P[p * 3 + 2] - o[2], t = T[p];
    P[p * 3] = o[0] + d[0] * t + (x - d[0] * t) * s; P[p * 3 + 1] = o[1] + d[1] * t + (y - d[1] * t) * s; P[p * 3 + 2] = o[2] + d[2] * t + (z - d[2] * t) * s; }
}
// the trunk's curtain: per 2 cm column of x, the front (and the back) may not be nearer the body than the rows above it from `from` down
// (a vertical drop in z at fixed x: the cloth falls from a breast's apex, the belly or the shoulder blades in the plane it hangs in, and
// an undercut under a heavy breast is spanned without folding the cloth over, which the radial version did), with the tent (the upper
// concave hull of each column, so the cloth spans straight from the collarbone to the apex) and a fade (k going out again lower down).
// st: { sel, zc, from (y), k, fade: [y0, y1] (k from full at y0 to 0 at y1), bin }
export function curtain(P, st) {
  const np = P.length / 3, bin = st.bin || 0.02, { sel, zc } = st;
  for (const sg of [1, -1]) {
    const cols = new Map(); let yMax = -Infinity, yMin = Infinity;
    for (let p = 0; p < np; p++) if (sel[p] && sg * (P[p * 3 + 2] - zc) > 0.01) { yMax = Math.max(yMax, P[p * 3 + 1]); yMin = Math.min(yMin, P[p * 3 + 1]); }
    if (!(yMax > yMin)) continue; const nr = Math.ceil((yMax - yMin) / bin) + 1, row = y => Math.floor((yMax - y) / bin), col = x => Math.floor(x / bin);
    for (let p = 0; p < np; p++) { if (!sel[p] || sg * (P[p * 3 + 2] - zc) <= 0.01) continue; const c = col(P[p * 3]); let a = cols.get(c); if (!a) { a = new Float64Array(nr).fill(-Infinity); cols.set(c, a); }
      const r = row(P[p * 3 + 1]); a[r] = Math.max(a[r], sg * (P[p * 3 + 2] - zc)); }
    // a max filter over the neighbouring cells (+-1 column, +-1 row: a nipple or a navel's rim is buried in a 4 cm plateau, as cloth in
    // tension rounds over a contact patch), then per row the upper concave hull across the columns (the cloth spans apex to apex, over
    // the cleavage), then per column the tent and the running max from `from` down
    const keys = [...cols.keys()].sort((a, b) => a - b), Z = new Map();
    for (const c of keys) { const a = cols.get(c), b = Float64Array.from(a); for (let r = 0; r < nr; r++) { if (a[r] === -Infinity) continue;
      for (let dc = -1; dc <= 1; dc++) { const n = cols.get(c + dc); if (!n) continue; for (let dr = -1; dr <= 1; dr++) { const v = n[r + dr]; if (v !== undefined && v > b[r]) b[r] = v; } } } Z.set(c, b); }
    for (let r = 0; r < nr; r++) { const pts = []; for (const c of keys) { const v = Z.get(c)[r]; if (v > -Infinity) pts.push([c, v]); } if (pts.length < 3) continue;
      const H = []; for (const q of pts) { while (H.length >= 2) { const u = H[H.length - 2], v = H[H.length - 1]; if ((v[0] - u[0]) * (q[1] - u[1]) - (v[1] - u[1]) * (q[0] - u[0]) >= 0) H.pop(); else break; } H.push(q); }
      for (let j = 0; j < H.length - 1; j++) { const [c1, z1] = H[j], [c2, z2] = H[j + 1]; for (let c = c1 + 1; c < c2; c++) { const a = Z.get(c); if (a && a[r] > -Infinity) a[r] = Math.max(a[r], z1 + (z2 - z1) * (c - c1) / (c2 - c1)); } } }
    const r0 = clamp(row(st.from), 0, nr - 1);
    for (const [, a] of Z) { const pts = []; for (let r = 0; r < nr; r++) if (a[r] > -Infinity) pts.push([r, a[r]]);
      if (st.tent && pts.length > 2) { const H = []; for (const q of pts) { while (H.length >= 2) { const u = H[H.length - 2], v = H[H.length - 1]; if ((v[0] - u[0]) * (q[1] - u[1]) - (v[1] - u[1]) * (q[0] - u[0]) >= 0) H.pop(); else break; } H.push(q); }
        for (let j = 0; j < H.length - 1; j++) { const [r1, z1] = H[j], [r2, z2] = H[j + 1]; for (let r = r1 + 1; r < r2; r++) if (a[r] > -Infinity) a[r] = Math.max(a[r], z1 + (z2 - z1) * (r - r1) / (r2 - r1)); } }
      let m = -Infinity; for (let r = r0; r < nr; r++) { if (a[r] > -Infinity) { m = Math.max(m, a[r]); a[r] = m; } } }
    for (let p = 0; p < np; p++) { if (!sel[p]) continue; const z = sg * (P[p * 3 + 2] - zc); if (z <= 0.01) continue; const a = Z.get(col(P[p * 3])); if (!a) continue; const y = P[p * 3 + 1], r = row(y);
      const k = (r >= r0 ? st.k : 1) * (st.fade ? 1 - sstep(st.fade[0], st.fade[1], y) : 1);   // fade: [y0 above, y1 below]
      if (a[r] > z) P[p * 3 + 2] += sg * (a[r] - z) * clamp(k); } }
}
export const sel = (G, f) => { const s = new Uint8Array(G.np); for (let p = 0; p < G.np; p++) if (f(G.AH[p * 4], G.AH[p * 4 + 2] > 0 ? 'L' : 'R', p)) s[p] = 1; return s; };
// the trunk's straight cut about a vertical axis through the middle of the chest section, down to `top` below the chest (the hips)
export function trunkStraight(G, yC, k, yStop) { const s = sel(G, (r, sd, p) => isTrunk(r) && G.Xb[p * 3 + 1] > yStop); let z0 = Infinity, z1 = -Infinity;
  for (let p = 0; p < G.np; p++) if (s[p] && Math.abs(G.Xb[p * 3 + 1] - yC) < 0.03) { z0 = Math.min(z0, G.Xb[p * 3 + 2]); z1 = Math.max(z1, G.Xb[p * 3 + 2]); }
  return { curtain: true, sel: s, zc: z0 < z1 ? (z0 + z1) / 2 : 0, from: yC + 0.06, k, tent: true }; }

// ---------------------------------------------------------------- one cloth
export function poseP(ctx, X, SI, SW) { const L = new Float64Array(X.length); for (let i = 0; i < X.length; i++) L[i] = X[i] / ctx.S; return skinPose(L, SI, SW, ctx.M, new Float64Array(X.length), ctx.S); }
function solveGarment(h, ctx, G, spec, o) {
  const t0 = now(), F = phys(spec.fabric), np = G.np, S = ctx.S;
  const { P, E } = spec.pattern ? spec.pattern(G) : { P: Float64Array.from(G.Xb), E: new Float64Array(np) };
  const X0 = poseP(ctx, P, G.SI, G.SW), XR = poseP(ctx, G.Xb, G.SI, G.SW);   // the pattern and the undraped shell, posed
  const pin = new Uint8Array(np), soft = []; spec.pins(G, pin, soft, XR, X0);   // pins may move X0 (trousers' waistband over a shirt)
  // what nothing holds and nothing sees stays as the shell had it, and is no layer: islands (a patch joined to nothing that is held)
  // and spec.dead (a top's strip past its cut, down into the crotch)
  const held = new Uint8Array(np); for (const a of soft) held[a.i] = 1; const comp = new Int32Array(np).fill(-1), frozen = new Uint8Array(np); let nf = 0;
  for (let p0 = 0; p0 < np; p0++) { if (comp[p0] >= 0) continue; const stack = [p0], mem = []; comp[p0] = p0; let anchored = false;
    while (stack.length) { const p = stack.pop(); mem.push(p); if (pin[p] || held[p]) anchored = true; for (const u of G.nb[p]) if (comp[u] < 0) { comp[u] = p0; stack.push(u); } }
    if (!anchored && mem.length < np * 0.15) for (const p of mem) frozen[p] = 1; }
  if (spec.dead) for (let p = 0; p < np; p++) if (spec.dead(p, G)) frozen[p] = 1;
  for (let p = 0; p < np; p++) if (frozen[p]) { pin[p] = 1; nf++; if (!(spec.deadAtPattern && spec.dead && spec.dead(p, G))) for (let c = 0; c < 3; c++) X0[p * 3 + c] = XR[p * 3 + c]; }
  for (let i = soft.length - 1; i >= 0; i--) if (frozen[soft[i].i]) soft.splice(i, 1);
  // pinned particles start (and stay) outside the skin
  const gapB = GAP_SKIN + F.h / 2;
  for (let p = 0; p < np; p++) if (pin[p] && !frozen[p]) { const q = ctx.bodyPosed.closest(X0[p * 3], X0[p * 3 + 1], X0[p * 3 + 2], 0.08); if (q && q.d < gapB) { const k = gapB - q.d; X0[p * 3] += q.nx * k; X0[p * 3 + 1] += q.ny * k; X0[p * 3 + 2] += q.nz * k; } }
  // warp: along the limb on sleeves and legs, down the body on the trunk (bind space)
  const warp = new Float64Array(np * 3), ax = spec.axes;
  for (let p = 0; p < np; p++) { const r = G.AH[p * 4], sd = G.AH[p * 4 + 2] > 0 ? 'L' : 'R'; let d = [0, -1, 0]; if (isArm(r)) d = ax.arm[sd].d; else if (isLeg(r)) d = ax.leg[sd].d; warp.set(d, p * 3); }
  // the cloth is only what is solved: triangles touching a frozen particle are left out of the constraints, so a dead strip (a top's
  // shell under a skirt's join or inside the trousers) neither holds the cloth up from below (the jacket sagged onto it and buckled into
  // a waist roll) nor tethers it; the free edge hangs from the pins like a hem
  const trisC = nf ? G.tris.filter((_, i, T) => { const t = i - (i % 3); return !(frozen[T[t]] || frozen[T[t + 1]] || frozen[T[t + 2]]); }) : G.tris;
  const cl = new Cloth(P, trisC, F, { X0, pin, warp, restAngle: spec.restAngle ?? 0, compress: 0.25, gravity: ctx.grav, damping: 6, vmax: 1.0, self: spec.self ?? 0.006, selfSkip: 4, stretchIters: o.iters, slack: 0.015 });
  if (soft.length) cl.attach(soft);
  const surf = [{ mesh: ctx.bodyPosed, gap: gapB, mu: F.mu, reach: 0.05 }];
  for (const L of spec.under || []) { let mask = null;
    if (L.ceiling) { mask = new Uint8Array(np); for (let p = 0; p < np; p++) { if (frozen[p] || !isTrunk(G.AH[p * 4])) continue; const q = L.surf.closest(XR[p * 3], XR[p * 3 + 1], XR[p * 3 + 2], 0.05); if (q && !q.edge && q.d > -0.005) mask[p] = 1; } }
    surf.push({ mesh: L.surf || L.mesh, gap: (L.h + F.h) / 2 + 0.0015, mu: F.mu, reach: 0.05, garment: !L.solid, mask }); }
  const ct = new Contacts(np, surf);
  cl.run(o.T, { hz: o.hz, contacts: ct, every: 6, selfEvery: 30 });
  const X = cl.X;
  // the frozen strip rides with the cloth it was cut from (ring by ring, the mean move of its already-moved neighbours): the triangles
  // across the cut keep their shape, so the hem the shader cuts there is not drawn through stretched slivers (the ragged jacket edge)
  if (nf) { const done = new Uint8Array(np), dsp = new Float64Array(np * 3); let front = [];
    for (let p = 0; p < np; p++) if (!frozen[p]) { done[p] = 1; for (let c = 0; c < 3; c++) dsp[p * 3 + c] = X[p * 3 + c] - X0[p * 3 + c]; }
    for (let p = 0; p < np; p++) if (frozen[p] && G.nb[p].some(u => done[u])) front.push(p);
    for (let ring = 0; ring < 40 && front.length; ring++) { const next = new Set();
      for (const p of front) { let n = 0, dx = 0, dy = 0, dz = 0; for (const u of G.nb[p]) if (done[u]) { dx += dsp[u * 3]; dy += dsp[u * 3 + 1]; dz += dsp[u * 3 + 2]; n++; } if (!n) continue;
        dsp[p * 3] = dx / n; dsp[p * 3 + 1] = dy / n; dsp[p * 3 + 2] = dz / n; }
      for (const p of front) { done[p] = 2; for (const u of G.nb[p]) if (!done[u]) next.add(u); }
      front = [...next]; }
    for (let p = 0; p < np; p++) if (frozen[p] && done[p]) for (let c = 0; c < 3; c++) X[p * 3 + c] = X0[p * 3 + c] + dsp[p * 3 + c]; }
  // measures (free particles): penetration of the (pressed) skin, mean gap within 3 cm of it, stretch, how far the solve moved the garment
  const mb = ct.measure(X, 0, 0.03, frozen), st = cl.strain(true); let mv = 0, mvx = 0, nm = 0; for (let p = 0; p < np; p++) { if (frozen[p]) continue; const d = Math.hypot(X[p * 3] - XR[p * 3], X[p * 3 + 1] - XR[p * 3 + 1], X[p * 3 + 2] - XR[p * 3 + 2]); mv += d; nm++; mvx = Math.max(mvx, d); }
  const Nn = orientOut(X, G.tris, ctx.bodyPosed), fp = foldSignal(X, G.tris, G.nb, F.c, Nn);
  // write back: each vertex through the inverse of its own blended skinning matrix (offset outward where a shell shares a particle)
  const tmp = [0, 0, 0], parts = [];
  for (const { m, pid, off } of G.meshes) { const g = m.geometry, n = g.attributes.position.count, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, out = new Float32Array(n * 3), fold = new Float32Array(n);
    for (let v = 0; v < n; v++) { const p = pid[v], k = off && G.owner[p] & (G.owner[p] - 1) ? off : 0;   // shared by two shells
      blendInverse(SI, SW, v, ctx.M, (X[p * 3] + Nn[p * 3] * k) / S, (X[p * 3 + 1] + Nn[p * 3 + 1] * k) / S, (X[p * 3 + 2] + Nn[p * 3 + 2] * k) / S, tmp, 0); out[v * 3] = tmp[0]; out[v * 3 + 1] = tmp[1]; out[v * 3 + 2] = tmp[2]; fold[v] = fp[p]; }
    parts.push({ m, out, fold }); }
  // the draped cloth as a layer for what goes over it (posed), and its bind shape (for a pattern cut over it)
  const layerTris = nf ? G.tris.filter((_, i, T) => { const t = i - (i % 3); return !(frozen[T[t]] && frozen[T[t + 1]] && frozen[T[t + 2]]); }) : G.tris;
  const posed = new SurfaceMesh(X, layerTris, { cell: 0.03, normals: Nn, boundary: true });
  const Xbind = new Float64Array(np * 3); for (let p = 0; p < np; p++) { blendInverse(G.SI, G.SW, p, ctx.M, X[p * 3] / S, X[p * 3 + 1] / S, X[p * 3 + 2] / S, tmp, 0); for (let c = 0; c < 3; c++) Xbind[p * 3 + c] = tmp[c] * S; }
  const Nb = vertexNormals(Xbind, layerTris); if (Nn.sign < 0) for (let i = 0; i < Nb.length; i++) Nb[i] = -Nb[i];
  const bindSurf = new SurfaceMesh(Xbind, layerTris, { cell: 0.03, normals: Nb, boundary: true });
  const rep = { part: spec.key, fabric: spec.fabric, verts: np, constraints: cl.stats.stretch + cl.stats.bend + cl.stats.tethers + (cl.stats.attach || 0), substeps: cl.stats.substeps, iterations: o.iters,
    ms: Math.round(now() - t0), penMax: Math.max(0, -mb.min) * 1000, inside: mb.inside, gapMean: mb.mean * 1000, stretchMean: st.mean, stretchP95: st.p95, stretchP99: st.p99, stretchMax: st.max, stretchMaxL: st.maxL, pins: pin.reduce((a, b) => a + b, 0) - nf + soft.length,
    frozen: nf, moveMean: nm ? mv / nm * 1000 : 0, moveMax: mvx * 1000, easeMean: E.reduce((a, b) => a + b, 0) / np * TAU * 100 };
  if (o.debug) o.debug[spec.key] = { cl, G, X0, XR, P, E, pin, frozen, bodyPosed: ctx.bodyPosed, bodyBind: ctx.bodyBind, under: spec.under };
  // the solved (not frozen) particles alone, for a part that rides on this cloth (a skirt's join)
  const live = []; for (let p = 0; p < np; p++) if (!frozen[p]) live.push(p);
  const liveRest = Float64Array.from(live.flatMap(p => [G.Xb[p * 3], G.Xb[p * 3 + 1], G.Xb[p * 3 + 2]])), liveBind = Float64Array.from(live.flatMap(p => [Xbind[p * 3], Xbind[p * 3 + 1], Xbind[p * 3 + 2]]));
  return { parts, posed, bindSurf, h: F.h, rep, Xbind, restBind: G.Xb, liveRest, liveBind };
}
// outward vertex normals of a draped cloth (the side away from the body); .sign = the flip used
export function orientOut(X, tris, body) { const N = vertexNormals(X, tris), n = X.length / 3; let s = 0;
  for (let p = 0; p < n; p += 5) { const q = body.closest(X[p * 3], X[p * 3 + 1], X[p * 3 + 2], 0.1); if (q) s += N[p * 3] * (X[p * 3] - q.px) + N[p * 3 + 1] * (X[p * 3 + 1] - q.py) + N[p * 3 + 2] * (X[p * 3 + 2] - q.pz); }
  const sign = s < 0 ? -1 : 1; if (sign < 0) for (let i = 0; i < N.length; i++) N[i] = -N[i]; N.sign = sign; return N; }
// fold-scale mean curvature x c: H = -2 (L . n) / sum |e|^2 x deg (umbrella L; 1/R on a sphere, 1/2R on a cylinder), minus its own
// average over ~3 rings (the limb's roundness), times the fabric's bending length
export function foldSignal(X, tris, nb, c, N) {
  const n = X.length / 3, Hc = new Float64Array(n);
  for (let p = 0; p < n; p++) { const L = nb[p]; if (!L.length) continue; let sx = 0, sy = 0, sz = 0, e2 = 0; for (let j = 0; j < L.length; j++) { const u = L[j], dx = X[u * 3] - X[p * 3], dy = X[u * 3 + 1] - X[p * 3 + 1], dz = X[u * 3 + 2] - X[p * 3 + 2]; sx += dx; sy += dy; sz += dz; e2 += dx * dx + dy * dy + dz * dz; }
    Hc[p] = -2 * (sx * N[p * 3] + sy * N[p * 3 + 1] + sz * N[p * 3 + 2]) / Math.max(e2, 1e-10); }
  let A = Float64Array.from(Hc); for (let it = 0; it < 8; it++) { const B = new Float64Array(n); for (let p = 0; p < n; p++) { const L = nb[p]; let s = A[p]; for (let j = 0; j < L.length; j++) s += A[L[j]]; B[p] = s / (L.length + 1); } A = B; }
  const out = new Float64Array(n); for (let p = 0; p < n; p++) out[p] = clamp((Hc[p] - A[p]) * c, -2, 2); return out;
}

// ---------------------------------------------------------------- parts that ride on a shell (rims, collar, pockets)
// for each vertex of a part, the 4 nearest undraped vertices of the parent (bind) and inverse-distance weights of their displacement
export function follow(partPos, parentRest, parentNew, cell = 0.02) {
  const n = partPos.length / 3, m = parentRest.length / 3, ic = 1 / cell, H = new Map(), key = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);
  for (let v = 0; v < m; v++) { const k = key(Math.floor(parentRest[v * 3] * ic), Math.floor(parentRest[v * 3 + 1] * ic), Math.floor(parentRest[v * 3 + 2] * ic)); const L = H.get(k); if (L) L.push(v); else H.set(k, [v]); }
  const out = new Float32Array(partPos.length), best = []; let worst = 0;
  for (let v = 0; v < n; v++) { const x = partPos[v * 3], y = partPos[v * 3 + 1], z = partPos[v * 3 + 2], ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic);
    for (let r = 1; r <= 6; r++) { best.length = 0; for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) { const L = H.get(key(ci + a, cj + b, ck + c)); if (!L) continue;
      for (const u of L) best.push([(parentRest[u * 3] - x) ** 2 + (parentRest[u * 3 + 1] - y) ** 2 + (parentRest[u * 3 + 2] - z) ** 2, u]); } if (best.length >= 4) break; }
    best.sort((p, q) => p[0] - q[0]); let ws = 0, dx = 0, dy = 0, dz = 0;
    for (const [d2, u] of best.slice(0, 4)) { const w = 1 / (Math.sqrt(d2) + 0.002); ws += w; dx += w * (parentNew[u * 3] - parentRest[u * 3]); dy += w * (parentNew[u * 3 + 1] - parentRest[u * 3 + 1]); dz += w * (parentNew[u * 3 + 2] - parentRest[u * 3 + 2]); }
    if (ws > 0) { dx /= ws; dy /= ws; dz /= ws; } if (best.length) worst = Math.max(worst, Math.sqrt(best[0][0]));
    out[v * 3] = x + dx; out[v * 3 + 1] = y + dy; out[v * 3 + 2] = z + dz; }
  out.worst = worst; return out;
}
export function meanNearest(partPos, parentRest) { let s = 0, k = 0; for (let v = 0; v < partPos.length / 3; v += 7) { let b = Infinity; for (let u = 0; u < parentRest.length / 3; u += 2) b = Math.min(b, (parentRest[u * 3] - partPos[v * 3]) ** 2 + (parentRest[u * 3 + 1] - partPos[v * 3 + 1]) ** 2 + (parentRest[u * 3 + 2] - partPos[v * 3 + 2]) ** 2); s += Math.sqrt(b); k++; } return s / Math.max(1, k); }

// ---------------------------------------------------------------- writing a shape onto a mesh (the c7 normal rule, the contract)
export function commit(m, pos, fold, shared) {
  const g = m.geometry, R = g.userData.drapeRest; g.attributes.position.array.set(pos); g.attributes.position.needsUpdate = true;
  if (g.index && R.index && R.normal) { const idx = Uint32Array.from(R.index), N0 = R.normal;
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2], vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, rx = N0[a * 3] + N0[b * 3] + N0[c * 3], ry = N0[a * 3 + 1] + N0[b * 3 + 1] + N0[c * 3 + 1], rz = N0[a * 3 + 2] + N0[b * 3 + 2] + N0[c * 3 + 2];
      if (nx * rx + ny * ry + nz * rz < 0) { idx[t + 1] = c; idx[t + 2] = b; } }
    g.index.array.set(idx); g.index.needsUpdate = true; }
  g.computeVertexNormals();
  if (R.normal) { const Nn = g.attributes.normal.array, N0 = R.normal; for (let k = 0; k < Nn.length / 3; k++) { let x = Nn[k * 3], y = Nn[k * 3 + 1], z = Nn[k * 3 + 2]; const d = x * N0[k * 3] + y * N0[k * 3 + 1] + z * N0[k * 3 + 2];
      if (d < 0.3) { const w = 0.3 - d; x += N0[k * 3] * w * 1.5; y += N0[k * 3 + 1] * w * 1.5; z += N0[k * 3 + 2] * w * 1.5; } const l = Math.hypot(x, y, z) || 1; Nn[k * 3] = x / l; Nn[k * 3 + 1] = y / l; Nn[k * 3 + 2] = z / l; } }
  const BA = g.attributes.position.constructor;   // three's BufferAttribute class, without importing three here
  g.setAttribute('aRest', new BA(Float32Array.from(R.position), 3)); if (fold) g.setAttribute('aFold', new BA(Float32Array.from(fold), 1));
  g.computeBoundingSphere?.(); g.computeBoundingBox?.();
  // the define is set on the material's OWN defines object, in place: fabric_glsl.js fabricDepth (the garment's shadow) shares that object.
  // (No clone: three's Material.clone drops onBeforeCompile. A mesh that shares a draped material but is not draped gets aRest = its
  // own position in restShared, so it renders as before.)
  const mat = m.material; if (!mat.defines) mat.defines = {}; mat.defines.CLOTH_REST = 1; if (fold) mat.defines.CLOTH_FOLD = 1; mat.needsUpdate = true; shared.add(mat);
  for (const d of [m.customDepthMaterial, m.customDistanceMaterial]) if (d) d.needsUpdate = true;
}
// every mesh of the hero whose material now carries CLOTH_REST must have aRest (an undraped one: its own position)
export function restShared(h, shared) { h.group.traverse(x => { if (!x.isMesh || !shared.has(x.material) || x.geometry.attributes.aRest) return; const g = x.geometry, BA = g.attributes.position.constructor;
  g.setAttribute('aRest', new BA(Float32Array.from(g.attributes.position.array), 3));
  if (x.material.defines.CLOTH_FOLD && !g.attributes.aFold) g.setAttribute('aFold', new BA(new Float32Array(g.attributes.position.count), 1)); }); }

// ---------------------------------------------------------------- bakes
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const r4 = x => (Math.round(x * 1e4) / 1e4 + 0).toFixed(4);
function meshesOf(h) { const out = []; for (const [k, v] of Object.entries(h.cloth || {})) { if (k === 'boots' || k === 'gloves') continue; list(v).forEach((m, i) => out.push([Array.isArray(v) ? `${k}.${i}` : k, m])); } return out; }
export function bakeKey(h, ctx) {
  const parts = [`D${DRAPE_VERSION}`, `X${XPBD_VERSION}`, h.o?.variant || '', JSON.stringify(Object.fromEntries(['top', 'bottom', 'vest', 'skirt'].map(k => [k, fabricFor(h, k)])))];
  for (const b of h.bones) parts.push([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, b.position.x, b.position.y, b.position.z, b.scale.x, b.scale.y, b.scale.z].map(r4).join(','));
  parts.push(ctx.grav.map(x => x.toFixed(2)).join(','), r4(ctx.S));
  for (const [id, m] of meshesOf(h)) { const P = (m.geometry.userData.drapeRest || {}).position || m.geometry.attributes.position.array; let s = 0; for (let i = 0; i < P.length; i++) s += P[i] * ((i % 7) + 1); parts.push(`${id}:${P.length / 3}:${s.toFixed(3)}`); }
  return `${h.o?.variant || 'hero'}-${fnv(parts.join('|'))}${fnv(parts.slice().reverse().join('|'))}`;
}
export const BAKE_DIR = new URL('../../../assets/cloth/bakes/', import.meta.url);
export function packBake(key, entries) {   // entries: [{ id, pos (Float32Array), rest (Float32Array), fold (Float32Array | null) }]
  const Q = 5e-5, head = { v: 1, key, q: Q, meshes: [] }, chunks = [];
  for (const e of entries) { const n = e.pos.length / 3, d = new Int16Array(n * 3); for (let i = 0; i < n * 3; i++) d[i] = clamp(Math.round((e.pos[i] - e.rest[i]) / Q), -32767, 32767); chunks.push(new Uint8Array(d.buffer));
    let f = null; if (e.fold) { f = new Int8Array(n); for (let i = 0; i < n; i++) f[i] = clamp(Math.round(e.fold[i] * 63), -127, 127); chunks.push(new Uint8Array(f.buffer)); }
    if ((d.byteLength + (f ? f.byteLength : 0)) % 2) chunks.push(new Uint8Array(1)); head.meshes.push({ id: e.id, n, fold: !!f }); }
  const hj = new TextEncoder().encode(JSON.stringify(head)), pad = (4 - (hj.length % 4)) % 4, total = 4 + hj.length + pad + chunks.reduce((a, c) => a + c.length, 0), out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, hj.length + pad, true); out.set(hj, 4); out.fill(32, 4 + hj.length, 4 + hj.length + pad); let o = 4 + hj.length + pad; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}
export function unpackBake(buf) {
  const u8 = new Uint8Array(buf), hl = new DataView(u8.buffer, u8.byteOffset).getUint32(0, true), head = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hl))); let o = 4 + hl; const out = new Map();
  for (const m of head.meshes) { const d = new Int16Array(u8.slice(o, o + m.n * 6).buffer); o += m.n * 6; let f = null; if (m.fold) { f = new Int8Array(u8.slice(o, o + m.n).buffer); o += m.n; } if ((m.n * 6 + (m.fold ? m.n : 0)) % 2) o += 1; out.set(m.id, { d, f, n: m.n }); }
  return { head, out };
}
export async function loadBake(key) { try { if (typeof fetch !== 'function') return null; const r = await fetch(new URL(`${key}.bin`, BAKE_DIR)); if (!r || r.ok === false) return null; return unpackBake(await r.arrayBuffer()); } catch (e) { return null; } }

// ---------------------------------------------------------------- the hero
// opts: { cache (true: try a bake first), collect (true: also return the bake bytes as r.bake), T (s), hz, iters, parts (keys), debug ({}) }
export async function drapeHero(h, opts = {}) {
  // debug knobs from a lab's URL (&drapeT=0 shows the pattern posed, unsolved; &drapeCache=0 forces a live solve; &drapeParts=top,bottom)
  const U = typeof location !== 'undefined' && location.search ? new URLSearchParams(location.search) : null, uo = {};
  if (U) { if (U.get('drapeT') != null) uo.T = +U.get('drapeT'); if (U.get('drapeCache') === '0') uo.cache = false; if (U.get('drapeParts')) uo.parts = U.get('drapeParts').split(','); }
  const t0 = now(), o = { cache: true, collect: false, T: 0.8, hz: 900, iters: 2, ...opts, ...uo };
  if (!h.cloth || !h.body) return { garments: [], error: 'no cloth' };
  for (const [, m] of meshesOf(h)) { keepRest(m); restore(m); }
  const ctx = context(h), key = bakeKey(h, ctx), shared = new Set();
  if (o.cache) { const b = await loadBake(key); if (b && b.head.key === key) { let ok = true; const todo = [];
      for (const [id, m] of meshesOf(h)) { const e = b.out.get(id); if (!e) continue; if (e.n !== m.geometry.attributes.position.count) { ok = false; break; } todo.push([m, e]); }
      if (ok && todo.length) { for (const [m, e] of todo) { const R = m.geometry.userData.drapeRest.position, pos = new Float32Array(R.length); for (let i = 0; i < R.length; i++) pos[i] = R[i] + e.d[i] * b.head.q;
          commit(m, pos, e.f ? Float32Array.from(e.f, x => x / 63) : null, shared); }
        restShared(h, shared); return { cached: true, key, ms: Math.round(now() - t0), garments: [], attached: [] }; } } }
  // ---- the hero's measures (bind, metres)
  const C = h.cloth, sk = !!C.skirt, kind = h.o?.kind || 'work', coverall = kind === 'coverall' && !!C.top && !!C.bottom, fit = TOP_CUT[kind] || TOP_CUT.work, S = ctx.S, H = ctx.H, J = ctx.J;
  const axis = (a, b, sg) => { const A = J(a), B = J(b), d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...d), u = d.map(x => x / l), k = sg * u[0], e = [sg - u[0] * k, -u[1] * k, -u[2] * k], le = Math.hypot(...e) || 1; return { o: A, d: u, len: l, e: e.map(x => x / le) }; };
  const arm = { L: axis('upperarm01.L', 'wrist.L', 1), R: axis('upperarm01.R', 'wrist.R', -1) }, leg = { L: axis('upperleg01.L', 'foot.L', 1), R: axis('upperleg01.R', 'foot.R', -1) }, axes = { arm, leg };
  const yS = J('upperarm01.L')[1] + 0.03, yC = yS - 0.13, yW = ctx.hem('waistY'), yHip = ctx.hem('hipY'), armEnd = H.armEnd ?? 2, legLen = leg.L.len;
  const boots = list(C.boots); let bootSurf = null;
  if (boots.length) { const Ps = [], Ts = []; let off = 0; for (const m of boots) { const g = m.geometry, n = g.attributes.position.count, X = skinPose(g.attributes.position.array, g.attributes.skinIndex.array, g.attributes.skinWeight.array, ctx.M, new Float64Array(n * 3), S);
      for (let i = 0; i < X.length; i++) Ps.push(X[i]); const ix = g.index.array; for (let i = 0; i < ix.length; i++) Ts.push(ix[i] + off); off += n; }
    bootSurf = { mesh: new SurfaceMesh(Float64Array.from(Ps), Int32Array.from(Ts), { cell: 0.03 }), h: 0.01, solid: true }; }   // a boot's open shaft top (its padded collar) must push the cloth well out: the trousers' edges are 2.5 cm
  // ---- the cuts
  const topFab = fabricFor(h, 'top'), botFab = fabricFor(h, 'bottom');
  const kTop = KNIT.has(topFab) ? 0.6 : topFab === 'leather' ? 0.85 : 1, lcut = coverall ? LEG_CUT.coverall : botFab === 'denim' ? LEG_CUT.denim : LEG_CUT.work, kLeg = KNIT.has(botFab) ? 0.5 : 1;
  const easeArm = lc => { const t = clamp(lc, 0, 2); return kTop * (t < 1 ? fit.uarm * sstep(0, 0.18, t) : fit.uarm + (fit.farm - fit.uarm) * (t - 1)); };
  const easeTrunkTop = y => y > yS ? 0 : kTop * (y > yC ? fit.chest * sstep(yS, yC, y) : fit.chest + (fit.waist - fit.chest) * (1 - fit.straight) * sstep(yC, yW, y));
  const easeLeg = lc => { const t = clamp(lc, 0, 2); return kLeg * (t < 1 ? lcut.seat + (lcut.thigh - lcut.seat) * t : lcut.thigh + (lcut.knee - lcut.thigh) * clamp(t - 1)); };
  const legStraight = G => ['L', 'R'].flatMap(s => [{ sel: sel(G, (r, sd) => r === RG.thigh && sd === s), o: leg[s].o, d: leg[s].d, e: leg[s].e, from: legLen * 0.08, ramp: legLen * 0.1, k: lcut.straight },
    { sel: sel(G, (r, sd) => (r === RG.shin || r === RG.foot) && sd === s), o: leg[s].o, d: leg[s].d, e: leg[s].e, from: legLen * 0.45, ramp: legLen * 0.1, k: 1 }]);
  const armStraight = G => ['L', 'R'].map(s => ({ sel: sel(G, (r, sd) => isArm(r) && sd === s), o: arm[s].o, d: arm[s].d, e: arm[s].e, from: arm[s].len * 0.4, ramp: arm[s].len * 0.2, k: 0.3 }));
  const lengthenTop = (P, AH) => { for (let p = 0; p < P.length / 3; p++) { const r = AH[p * 4];
    if (isTrunk(r) && fit.len && P[p * 3 + 1] < yC && P[p * 3 + 1] > yHip - 0.05) P[p * 3 + 1] -= (yC - P[p * 3 + 1]) * fit.len / Math.max(0.1, yC - yW);
    if (isArm(r) && fit.slv) { const s = AH[p * 4 + 2] > 0 ? 'L' : 'R', w = clamp((AH[p * 4 + 1] - 0.2) / 1.8); for (let c = 0; c < 3; c++) P[p * 3 + c] += arm[s].d[c] * fit.slv * w; } } };
  const lengthenLeg = (P, AH) => { for (let p = 0; p < P.length / 3; p++) { const r = AH[p * 4], x = P[p * 3], y = P[p * 3 + 1];
    if (isLeg(r)) { const s = AH[p * 4 + 2] > 0 ? 'L' : 'R', t = (P[p * 3] - leg[s].o[0]) * leg[s].d[0] + (P[p * 3 + 1] - leg[s].o[1]) * leg[s].d[1] + (P[p * 3 + 2] - leg[s].o[2]) * leg[s].d[2], w = clamp(t / legLen); for (let c = 0; c < 3; c++) P[p * 3 + c] += leg[s].d[c] * lcut.len * w; }
    if (lcut.drop) P[p * 3 + 1] -= lcut.drop * Math.exp(-((x / 0.065) ** 2)) * Math.exp(-(((y - (yHip - 0.05)) / 0.09) ** 2)); } };
  const shellTop = (p, r, lc, y) => isTrunk(r) ? sstep(yS - 0.12, yS - 0.03, y) : isArm(r) ? sstep(0.14, 0.03, lc) * sstep(yS - 0.14, yS - 0.04, y) : 0;
  const shellBottom = (p, r, lc, y) => isLeg(r) ? 0 : sstep(yW - 0.07, yW - 0.03, y);
  const trunkFromShell = (p, r, y) => isTrunk(r) && y > yHip;
  const yokePin = (G, p) => { const r = G.AH[p * 4], y = G.Xb[p * 3 + 1]; return (isTrunk(r) && y > yS - 0.035) || (isArm(r) && G.AH[p * 4 + 1] < 0.05 && y > yS - 0.08); };
  const done = {}, reps = [], parents = [];
  const order = sk ? ['bottom', 'top', 'skirt'] : ['top', 'bottom'];
  // the vest is NOT draped in c1: hero.js cuts its armholes, V neck, hem and zip on the bind position (vBind), so moving its bind shape
  // moves the cuts off its bound edges (garment.js rims). It stays as built, and is a ceiling the top drapes under (inward normals).
  let vestCeil = null;
  if (C.vest && !Array.isArray(C.vest)) { const g = C.vest.geometry, R = keepRest(C.vest), { pid, rep, np } = weld(R.position), T = remapTris(R.index || g.index.array, pid);
    const L = new Float64Array(np * 3), SIv = new Uint16Array(np * 4), SWv = new Float32Array(np * 4), GI = g.attributes.skinIndex.array, GW = g.attributes.skinWeight.array;
    for (let p = 0; p < np; p++) { const v = rep[p]; for (let c = 0; c < 3; c++) L[p * 3 + c] = R.position[v * 3 + c]; for (let c = 0; c < 4; c++) { SIv[p * 4 + c] = GI[v * 4 + c]; SWv[p * 4 + c] = GW[v * 4 + c]; } }
    const Xv = skinPose(L, SIv, SWv, ctx.M, new Float64Array(np * 3), S);
    const Nv = orientOut(Xv, T, ctx.bodyPosed); for (let i = 0; i < Nv.length; i++) Nv[i] = -Nv[i];
    vestCeil = { surf: new SurfaceMesh(Xv, T, { cell: 0.03, normals: Nv, boundary: true }), h: phys(fabricFor(h, 'vest')).h + 0.002, ceiling: true };
    // the vest in bind space (outward normals): the top's pattern is kept under it (a shirt cut with 12 cm of ease stood out through a
    // vest that sits ~1 cm off the body; the ceiling contact cannot pull back cloth that starts outside)
    const Lb = new Float64Array(np * 3); for (let i = 0; i < Lb.length; i++) Lb[i] = L[i] * S;
    vestCeil.bind = new SurfaceMesh(Lb, T, { cell: 0.03, normals: orientOut(Lb, T, ctx.bodyBind), boundary: true });
    parents.push({ k: 'vest', m: C.vest, rest: R.position, now: R.position }); }
  for (const key of order) {
    if (o.parts && !o.parts.includes(key)) continue;
    const m = C[key]; if (!m || Array.isArray(m) || (coverall && key === 'bottom')) continue;
    const fabric = fabricFor(h, key), F = phys(fabric), gap = GAP_SKIN + 0.0015 + F.h / 2; let G, spec;
    if (key === 'top' && coverall) {
      // the coverall: top and bottom shells as one cloth (merged where both were made from the same body vertex)
      G = particlesOf(h, [C.top, C.bottom], S, { byBody: true, offs: [0, 0.0015] });
      spec = { key: 'coverall', fabric, axes, restAngle: 0,
        pattern: G2 => pattern(ctx, G2, { keep: ctx.bodyBind, soft: ctx.bodySoft, hard: 0.003 + F.h / 2, gap, ease: (p, r, lc, x, y) => isArm(r) ? easeArm(lc) : isLeg(r) ? easeLeg(lc) : y > yW ? easeTrunkTop(y) : fit.waist * kTop + (lcut.seat - fit.waist * kTop) * sstep(yW, yHip, y),
          straight: [{ ...trunkStraight(G2, yC, fit.straight, -Infinity), fade: [yC - (yC - yW) * 0.3, yW - 0.01] }, ...armStraight(G2), ...legStraight(G2)], shell: shellTop,
          lengthen: (P, AH) => { lengthenTop(P, AH); lengthenLeg(P, AH); } }),
        pins: (G2, pin, soft, XR) => { for (let p = 0; p < G2.np; p++) { if (yokePin(G2, p)) { pin[p] = 1; continue; } const r = G2.AH[p * 4], lc = G2.AH[p * 4 + 1];
            if (isArm(r) && lc > armEnd - 0.06) soft.push({ i: p, x: [XR[p * 3], XR[p * 3 + 1], XR[p * 3 + 2]], alpha: 5e-6 });   // a buttoned cuff
          } },
        under: bootSurf ? [bootSurf] : [] };
    } else if (key === 'top') {
      G = particlesOf(h, [m], S, { byBody: true }); const tucked = !sk, coatLike = !!(TOP_CUT[kind] === TOP_CUT.coat || TOP_CUT[kind] === TOP_CUT.leather);
      spec = { key, fabric, axes, under: [...(sk && done.bottom ? [done.bottom] : []), ...(vestCeil ? [vestCeil] : [])], restAngle: fabric === 'leather' ? 0.4 : 0,
        dead: (p, G2) => !isArm(G2.AH[p * 4]) && G2.Xb[p * 3 + 1] < (sk && C.skirt ? (ctx.hem('skirtTop') || yW) - 0.02 : coatLike ? yHip - 0.08 : yW - 0.13), deadAtPattern: sk,
        pattern: G2 => pattern(ctx, G2, { keep: ctx.bodyBind, soft: ctx.bodySoft, hard: 0.003 + F.h / 2, gap, ease: (p, r, lc, x, y) => isArm(r) ? easeArm(lc) : easeTrunkTop(y),
          straight: [trunkStraight(G2, yC, fit.straight, -Infinity), ...armStraight(G2)], lengthen: lengthenTop, shell: shellTop,
          after: vestCeil && o.vestClamp !== false ? P => { const need = (vestCeil.h + F.h) / 2 + 0.002; for (let p = 0; p < G2.np; p++) { if (!isTrunk(G2.AH[p * 4])) continue;
            const q = vestCeil.bind.closest(P[p * 3], P[p * 3 + 1], P[p * 3 + 2], 0.06); if (!q || q.edge || q.d <= -need) continue; const k = q.d + need;
            P[p * 3] -= q.nx * k; P[p * 3 + 1] -= q.ny * k; P[p * 3 + 2] -= q.nz * k; } } : null }),
        pins: (G2, pin, soft, XR) => { for (let p = 0; p < G2.np; p++) { if (yokePin(G2, p)) { pin[p] = 1; continue; } const r = G2.AH[p * 4], y = G2.Xb[p * 3 + 1], lc = G2.AH[p * 4 + 1];
            if (tucked && isTrunk(r) && y < yW + 0.01) { const q = ctx.bodyPosed.closest(XR[p * 3], XR[p * 3 + 1], XR[p * 3 + 2], 0.1), t = 0.003 + F.h;   // the tail, snug inside the trousers
              soft.push({ i: p, x: q ? [q.px + q.nx * t, q.py + q.ny * t, q.pz + q.nz * t] : [XR[p * 3], XR[p * 3 + 1], XR[p * 3 + 2]], alpha: 2e-6 }); }
            else if (isArm(r) && !fit.slv && armEnd < 2 && lc > armEnd - 0.08) soft.push({ i: p, x: [XR[p * 3], XR[p * 3 + 1], XR[p * 3 + 2]], alpha: 2e-6 }); } } };   // held by the roll
    } else if (key === 'bottom') {
      G = particlesOf(h, [m], S, { byBody: true });
      spec = { key, fabric, axes, under: [...(!sk && done.top ? [done.top] : []), ...(bootSurf ? [bootSurf] : [])], restAngle: 0,
        pattern: G2 => pattern(ctx, G2, { keep: ctx.bodyBind, soft: ctx.bodySoft, hard: 0.003 + F.h / 2, gap, ease: (p, r, l, x, y) => isLeg(r) ? easeLeg(l) : kLeg * lcut.seat * sstep(yW - 0.02, yHip, y), straight: legStraight(G2), lengthen: lengthenLeg, shell: shellBottom }),
        pins: (G2, pin, soft, XR, X0) => { for (let p = 0; p < G2.np; p++) { const y = G2.Xb[p * 3 + 1], r = G2.AH[p * 4]; if (isLeg(r) || y <= yW - 0.035) continue; pin[p] = 1;   // the waistband
            if (done.top && !sk) { const q = done.top.surf.closest(X0[p * 3], X0[p * 3 + 1], X0[p * 3 + 2], 0.06), need = (done.top.h + F.h) / 2 + 0.0015;   // over a tucked shirt's tail
              if (q && !q.edge && q.d < need) { const k = need - q.d; X0[p * 3] += q.nx * k; X0[p * 3 + 1] += q.ny * k; X0[p * 3 + 2] += q.nz * k; } } } } };
    } else if (key === 'vest') {
      const top = done.top; if (!top) continue; G = particlesOf(h, [m], S);
      spec = { key, fabric, axes, under: [top], restAngle: 0, self: 0,
        pattern: G2 => pattern(ctx, G2, { keep: top.bindSurf, gap: (top.h + F.h) / 2 + 0.002, wrap: 20, ease: (p, r, lc, x, y) => (y > yS - 0.02 ? 0 : 0.06 * sstep(yS - 0.02, yC, y)), straight: [trunkStraight(G2, yC, 1, -Infinity)] }),
        pins: (G2, pin) => { for (let p = 0; p < G2.np; p++) if (G2.Xb[p * 3 + 1] > yS - 0.05) pin[p] = 1; } };
    } else if (key === 'skirt') {
      G = particlesOf(h, [m], S); const top = done.top, yTop = ctx.hem('skirtTop') || yW;
      // the skirt's join rides on the coat body (its top ring tucks 1.5 cm inside the coat), fading out 15 cm down
      if (top) { const dsp = follow(G.Xb, top.liveRest, top.liveBind, 0.03); for (let p = 0; p < G.np; p++) { const w = sstep(yTop - 0.15, yTop - 0.02, G.Xb[p * 3 + 1]); for (let c = 0; c < 3; c++) G.Xb[p * 3 + c] += (dsp[p * 3 + c] - G.Xb[p * 3 + c]) * w; } }
      // the skirt's turned hem (its last rings, folded back inside) keeps its sewn shape; the rest hangs as flat panels
      let yLow = Infinity; for (let p = 0; p < G.np; p++) yLow = Math.min(yLow, G.Xb[p * 3 + 1]);
      const ra = new Float64Array(G.np); for (let p = 0; p < G.np; p++) ra[p] = G.Xb[p * 3 + 1] < yLow + 0.02 ? 1 : fabric === 'leather' ? 0.4 : 0;
      spec = { key, fabric, axes, under: done.bottom ? [done.bottom] : [], restAngle: ra, self: 0, pattern: null,
        pins: (G2, pin) => { for (let p = 0; p < G2.np; p++) if (G2.Xb[p * 3 + 1] > yTop - 0.012) pin[p] = 1; } };
    } else continue;
    const res = solveGarment(h, ctx, G, spec, o);
    const d = { surf: res.posed, h: res.h, bindSurf: res.bindSurf, restBind: res.restBind, Xbind: res.Xbind, liveRest: res.liveRest, liveBind: res.liveBind };
    done[key] = d; if (spec.key === 'coverall') done.bottom = d;
    for (const pt of res.parts) { commit(pt.m, pt.out, pt.fold, shared); parents.push({ k: pt.m === C.top ? 'top' : pt.m === C.bottom ? 'bottom' : key, m: pt.m, rest: pt.m.geometry.userData.drapeRest.position, now: pt.out }); }
    reps.push(res.rep);
  }
  // parts that ride on a shell
  const attached = [];
  const ride = (m, pk, name) => { const R = keepRest(m).position; let par = pk ? parents.find(p => p.k === pk) : null;
    if (!par) { let best = Infinity; for (const p of parents) { const dd = meanNearest(R, p.rest); if (dd < best) { best = dd; par = p; } } }
    if (!par) return; const pos = follow(R, par.rest, par.now);
    // a rim (garment.js rim) copies the skinning and aHero x, y, z of the shell vertex at its edge node: all 8 vertices round that node
    // move with that vertex, so the binding stays on the cut and keeps its section
    const g = m.geometry, pg = par.m.geometry, key = (G2, v) => { const I = G2.attributes.skinIndex.array, W = G2.attributes.skinWeight.array, A = G2.attributes.aHero.array;
      return `${I[v * 4]},${I[v * 4 + 1]},${I[v * 4 + 2]},${I[v * 4 + 3]},${W[v * 4].toFixed(5)},${W[v * 4 + 1].toFixed(5)},${A[v * 4].toFixed(4)},${A[v * 4 + 1].toFixed(5)},${A[v * 4 + 2]}`; };
    let exact = 0; if (name.startsWith('rim')) { const mp = new Map(); for (let v = 0; v < pg.attributes.position.count; v++) mp.set(key(pg, v), v);
      for (let v = 0; v < g.attributes.position.count; v++) { const u = mp.get(key(g, v)); if (u == null) continue; exact++; for (let c = 0; c < 3; c++) pos[v * 3 + c] = R[v * 3 + c] + par.now[u * 3 + c] - par.rest[u * 3 + c]; } }
    commit(m, pos, null, shared); attached.push(`${name} on ${par.k} (${exact ? `${exact} of ${g.attributes.position.count} on their own shell vertex, ` : ''}farthest vertex ${(pos.worst * 1000).toFixed(0)} mm from its nearest)`); };
  if (C.collar && parents.some(p => p.k === 'top')) ride(C.collar, 'top', 'collar');
  if (C.pockets && parents.some(p => p.k === 'skirt')) ride(C.pockets, 'skirt', 'pockets');
  list(C.rims).forEach((r, i) => ride(r, null, `rim ${i}`));
  restShared(h, shared);
  const res = { cached: false, key, ms: Math.round(now() - t0), garments: reps, attached };
  if (o.collect) { const entries = []; for (const [id, m] of meshesOf(h)) { const R = m.geometry.userData.drapeRest; if (!m.geometry.attributes.aRest) continue; const f = m.geometry.attributes.aFold;
      entries.push({ id, pos: m.geometry.attributes.position.array, rest: R.position, fold: f ? f.array : null }); }
    res.bake = packBake(key, entries); }
  return res;
}
