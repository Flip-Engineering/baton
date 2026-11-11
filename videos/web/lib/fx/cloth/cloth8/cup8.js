// CLOTH8 c6 it1 (15 Oct): THE MOULDED CUP, A STIFF PANEL THE BREAST FILLS. On the current person (Cycles 1015-055136, L08 L06) the nipples
// came through each bra cup as ragged, crumpled tears. Measured on the built person (labs/clothing2/cloth8/cup_probe.mjs, bind space): the
// cup's own shell is FOLDED within 4.5 cm of the apex (dihedral angles p95 55-67 deg, max 160-171 deg: flaps turned over; the shell 6 mm
// p95 / 11 mm max off its own smooth surface) and 6-15 body vertices per cup stand OUTSIDE it, up to 16-17 mm. The same with refit8 off and
// with the soft / pelvis stages off: it is the bake's fit itself. K3's fit (wardrobe4 / foundations) laid the cup as a membrane ON the skin,
// so it took the nipple and areola relief (hm08's fixed nipple patch, BODY7's NAC) into its own shape and crumpled round it; found8's dome
// (a Laplacian over a folded patch, lift capped at 4 mm) could not unfold it.
// A real moulded cup is the opposite: a pre-formed, foam-backed panel with BENDING STIFFNESS; it keeps its smooth shape and rests on the
// breast's form, and the soft tissue under it is COMPRESSED to its inside (the nipple at most a soft bump). So, on the person the build ends
// with (after refit8 has placed the underwear on the final body):
//   (1) the support: the breast's form without its sub-centimetre relief (the body round each apex Taubin-smoothed: no shrinkage, the
//       nipple and areola, a few mm across, smoothed away; the breast's volume kept);
//   (2) the panel: the cup's shell, within the cup's footprint (weight 1 to r0 from the apex, 0 at r1 and on the cup's free edges), relaxed
//       by Taubin smoothing (the stiffness: the bending energy minimised, flaps unfolded) and kept `clear` outside the support, alternated
//       `rounds` times so it ends smooth AND resting on the breast; what is sewn on the shell (bindings, straps) follows it (carry8);
//   (3) the tissue: every body vertex in the cup's footprint lying outside the panel's inside (the shell's `shell` thickness) is pressed in
//       along the panel's normal to it, the requirement spread over `spread` rings (a soft dimple, not a step), at most `maxPress`; written
//       on every body level and on CORRECT5's corrected-bind base (as pelvis7 and nosemouth7 do), normals rebuilt round it.
// Nothing is aimed at a shape: the panel's shape is the cup's own, smoothed; its rest is the person's breast; the press is what the panel
// leaves no room for. Byte-identical for anyone without a bra. Called by refit8's hook (refitPerson8; build.js runs it bare and dressed).
//   cupPerson8(P, o) -> report { cups: [{ side, panelVerts, liftMm, pressVerts, pressMaxMm }], bodyMoved }
import { SurfaceMesh } from '../collide.js';
import { bind8, place8 } from './carry8.js';
import { heroScale } from '../foundations.js';
export const CUP8_VERSION = 1;
export const CUP8_DEFAULT = { r0: 0.045, r1: 0.075, smooth: 40, rounds: 5, clear: 0.0015, shell: 0.001, spread: 3, maxPress: 0.02, bodyR: 0.095, bodySmooth: 30 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function adjacency(T, n, keep = null) { const nb = Array.from({ length: n }, () => []); const seen = new Set();
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = T[t + k], b = T[t + (k + 1) % 3]; if (keep && !keep[a] && !keep[b]) continue; const key = a < b ? a * n + b : b * n + a; if (seen.has(key)) continue; seen.add(key); nb[a].push(b); nb[b].push(a); }
  return nb; }
// Taubin lambda|mu smoothing of the weighted vertices (w 0: fixed); no shrinkage of the form, its high frequencies removed
function taubin(X, nb, w, its, lam = 0.5, mu = -0.53) { const n = X.length / 3, Y = new Float64Array(X.length);
  for (let it = 0; it < its * 2; it++) { const f = it % 2 ? mu : lam; Y.set(X);
    for (let v = 0; v < n; v++) { if (!w[v] || !nb[v].length) continue; let sx = 0, sy = 0, sz = 0; for (const u of nb[v]) { sx += X[u * 3]; sy += X[u * 3 + 1]; sz += X[u * 3 + 2]; } const c = nb[v].length, k = f * w[v];
      Y[v * 3] = X[v * 3] + k * (sx / c - X[v * 3]); Y[v * 3 + 1] = X[v * 3 + 1] + k * (sy / c - X[v * 3 + 1]); Y[v * 3 + 2] = X[v * 3 + 2] + k * (sz / c - X[v * 3 + 2]); }
    X.set(Y); } return X; }
// the bra's shell among the built person's parts: the found 'shell' followed by straps (the built records carry no owner), and what is sewn on it
export function braParts(P) { const F = (P.parts || []).filter(m => m.userData?.k3?.group === 'found');
  for (let i = 0; i < F.length; i++) { if (F[i].userData.k3.name !== 'shell') continue; const sewn = []; for (let j = i + 1; j < F.length && F[j].userData.k3.name !== 'shell'; j++) sewn.push(F[j]);
    if (sewn.some(m => /^strap\./.test(m.userData.k3.name))) return { shell: F[i], sewn }; }
  return null; }
function renormal(g, moved) {
  const N = g.attributes.normal?.array; if (!N) return; const X = g.attributes.position.array, I = g.index.array, nV = g.attributes.position.count, touch = new Uint8Array(nV);
  for (let t = 0; t < I.length; t += 3) if (moved[I[t]] || moved[I[t + 1]] || moved[I[t + 2]]) { touch[I[t]] = touch[I[t + 1]] = touch[I[t + 2]] = 1; }
  const acc = new Float64Array(nV * 3);
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], d = I[t + 2]; if (!(touch[a] || touch[b] || touch[d])) continue;
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], wx = X[d * 3] - X[a * 3], wy = X[d * 3 + 1] - X[a * 3 + 1], wz = X[d * 3 + 2] - X[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; for (const v of [a, b, d]) { acc[v * 3] += nx; acc[v * 3 + 1] += ny; acc[v * 3 + 2] += nz; } }
  for (let v = 0; v < nV; v++) if (touch[v]) { const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]); if (l > 0) { N[v * 3] = acc[v * 3] / l; N[v * 3 + 1] = acc[v * 3 + 1] / l; N[v * 3 + 2] = acc[v * 3 + 2] / l; } }
  g.attributes.normal.needsUpdate = true; }

export function cupPerson8(P, o = {}) {
  const O = { ...CUP8_DEFAULT, ...(o && typeof o === 'object' ? o : {}) }, h = P.h, body = h?.body, g = body?.geometry; if (!g) return { skipped: 'no body' };
  const B = braParts(P); if (!B) return { skipped: 'no bra' };
  const sc = heroScale(h) || 1, u = x => x / sc;   // metres -> the geometry's units
  const cg = B.shell.geometry, X = Float64Array.from(cg.attributes.position.array), T = Int32Array.from(cg.index.array), n = X.length / 3;
  const Xb = Float64Array.from(g.attributes.position.array), nb_ = Xb.length / 3, Tb = Int32Array.from(P.bodyIndexFull?.array ?? P.bodyIndexFull ?? g.userData.plan?.tri ?? g.index.array);
  // the apexes (bind: the figure faces +z): the cup's foremost point each side of the midline
  const apex = [null, null]; for (let v = 0; v < n; v++) { const s = X[v * 3] >= 0 ? 0 : 1; if (!apex[s] || X[v * 3 + 2] > apex[s][2]) apex[s] = [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]; }
  const dA = (x, y, z) => { let d = Infinity, s = -1; for (let k = 0; k < 2; k++) { const a = apex[k]; if (!a) continue; const e = Math.hypot(x - a[0], y - a[1], z - a[2]); if (e < d) { d = e; s = k; } } return [d * sc, s]; };
  // (1) the support: the body round the apexes, Taubin-smoothed
  const wb = new Float64Array(nb_), keepB = new Uint8Array(nb_); for (let v = 0; v < nb_; v++) { const [d] = dA(Xb[v * 3], Xb[v * 3 + 1], Xb[v * 3 + 2]); if (d < O.bodyR) { wb[v] = 1 - sstep(O.bodyR - 0.02, O.bodyR, d); keepB[v] = 1; } }
  const nbB = adjacency(Tb, nb_, keepB), Bs = taubin(Float64Array.from(Xb), nbB, wb, O.bodySmooth), Ssup = new SurfaceMesh(Bs, Tb, { cell: u(0.015) });
  // (2) the panel
  const nbC = adjacency(T, n), bnd = new SurfaceMesh(X, T, { cell: u(0.015), boundary: true }).bnd, w = new Float64Array(n);
  for (let v = 0; v < n; v++) { if (bnd[v]) continue; const [d] = dA(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); w[v] = 1 - sstep(O.r0, O.r1, d); }
  const Y = Float64Array.from(X); let lift = 0;
  // each round: the panel relaxed, then lifted off the support by a SMOOTH field (each vertex's need spread over its rings as max(own, ring
  // mean): a lift that bends the panel as a whole, not a projection that kinks it vertex by vertex)
  const need = new Float64Array(n), nrm = new Float64Array(n * 3);
  for (let r = 0; r < O.rounds; r++) { taubin(Y, nbC, w, O.smooth); need.fill(0);
    for (let v = 0; v < n; v++) { if (!w[v]) continue; const c = Ssup.closestAny(Y[v * 3], Y[v * 3 + 1], Y[v * 3 + 2], u(0.04)); if (!c || c.edge) continue;
      nrm[v * 3] = c.nx; nrm[v * 3 + 1] = c.ny; nrm[v * 3 + 2] = c.nz; need[v] = Math.max(0, u(O.clear) - c.d); }
    for (let k = 0; k < 4; k++) { const R = Float64Array.from(need); for (let v = 0; v < n; v++) { if (!w[v] || !nbC[v].length) continue; let m = 0; for (const q of nbC[v]) m += need[q]; R[v] = Math.max(need[v], m / nbC[v].length); } need.set(R); }
    for (let v = 0; v < n; v++) { if (!need[v]) continue; const k = need[v] * w[v]; Y[v * 3] += nrm[v * 3] * k; Y[v * 3 + 1] += nrm[v * 3 + 1] * k; Y[v * 3 + 2] += nrm[v * 3 + 2] * k; if (r === O.rounds - 1) lift = Math.max(lift, k * sc); } }
  const mv = new Uint8Array(n); let panelVerts = 0, panelMax = 0; for (let v = 0; v < n; v++) { const d = Math.hypot(Y[v * 3] - X[v * 3], Y[v * 3 + 1] - X[v * 3 + 1], Y[v * 3 + 2] - X[v * 3 + 2]); if (d > 1e-7) { mv[v] = 1; panelVerts++; panelMax = Math.max(panelMax, d * sc); } }
  // what is sewn on the shell follows it
  for (const m of B.sewn) { const a = m.geometry.attributes.position, Xq = Float64Array.from(a.array), Bd = bind8(Xq, X, T, { reach: u(0.02) }); if (place8(Bd, Y, T, Xq, mv)) { a.array.set(Xq); a.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere?.(); } }
  cg.attributes.position.array.set(Y); cg.attributes.position.needsUpdate = true; cg.computeVertexNormals(); cg.computeBoundingSphere?.();
  // (3) the tissue pressed to the panel's inside
  const Sp = new SurfaceMesh(Y, T, { cell: u(0.015), boundary: true }), req = new Float64Array(nb_), dir = new Float64Array(nb_ * 3), has = new Uint8Array(nb_);
  for (let v = 0; v < nb_; v++) { if (!keepB[v]) continue; const c = Sp.closest(Xb[v * 3], Xb[v * 3 + 1], Xb[v * 3 + 2], u(0.025)); if (!c || c.edge) continue;
    // only under the panel (the part of the cup this stage made: weight of the closest triangle); elsewhere the cup is the bake's fit
    const wt = (w[T[c.tri * 3]] + w[T[c.tri * 3 + 1]] + w[T[c.tri * 3 + 2]]) / 3; if (wt <= 0) continue;
    has[v] = 1; dir[v * 3] = -c.nx; dir[v * 3 + 1] = -c.ny; dir[v * 3 + 2] = -c.nz; const nd = (c.d + u(O.shell)) * wt; if (nd > 0) req[v] = Math.min(u(O.maxPress), nd); }
  for (let r = 0; r < O.spread; r++) { const R = Float64Array.from(req); for (let v = 0; v < nb_; v++) { if (!has[v] || !nbB[v].length) continue; let s = 0; for (const q of nbB[v]) s += req[q]; R[v] = Math.max(req[v], 0.5 * s / nbB[v].length); } req.set(R); }
  const D = new Float32Array(nb_ * 3); let pressVerts = 0, pressMax = 0;
  for (let v = 0; v < nb_; v++) if (req[v] > 0 && has[v]) { for (let q = 0; q < 3; q++) D[v * 3 + q] = dir[v * 3 + q] * req[v]; pressVerts++; pressMax = Math.max(pressMax, req[v] * sc); }
  // written on every level (the control vertices keep their indices: each level's vertices are a prefix of the next), and CORRECT5's base
  if (pressVerts) { const geoms = new Set([g, body.userData?.geomL0, ...Object.values(body.userData?.geoms || {})].filter(Boolean));
    for (const gg of geoms) { const A = gg.attributes.position.array, nV = Math.min(gg.attributes.position.count, nb_), moved = new Uint8Array(gg.attributes.position.count);
      for (let v = 0; v < nV; v++) { if (!req[v]) continue; A[v * 3] += D[v * 3]; A[v * 3 + 1] += D[v * 3 + 1]; A[v * 3 + 2] += D[v * 3 + 2]; moved[v] = 1; }
      renormal(gg, moved); gg.attributes.position.needsUpdate = true; gg.computeBoundingSphere?.(); gg.computeBoundingBox?.(); }
    const cb = body.userData?.correctBase; if (cb) for (let i = 0; i < Math.min(cb.length, D.length); i++) cb[i] += D[i];
    h.update?.(); }
  return { version: CUP8_VERSION, panelVerts, panelMaxMm: +(panelMax * 1000).toFixed(1), liftMm: +(lift * 1000).toFixed(1), pressVerts, pressMaxMm: +(pressMax * 1000).toFixed(1) };
}
