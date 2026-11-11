// BODY / NIPPLE (HUMAN c8 round 7, BODY7 iteration 2, 8 Oct 2026): the nipple-areola complex placed BY ANATOMY on the person's own reshaped surface.
// The orchestrator's 04:30 priority (the client: 'nipples are in the completely wrong area for a lot of your shots'): the areolae were painted at
// two FIXED hm08 vertices (likeness/zones4.js BODY_IDS nippleL 8471 / nippleR 1799; body/measure.js and body/detail.js read the same landmark), and
// every layer we have (the learned prior body, FORM, muscle, fat, the breast mound) reshapes the chest while those two vertices stay where hm08 put
// them. Measured (node, 8 Oct): on L21 (a man, 1.83 m) the fixed vertices are 14.8 cm apart, on L08 (a woman, 1.57 m) 12.7 cm; adult men's
// nipples are ~20-21 cm apart (a little lateral to the midclavicular line, the 4th intercostal space), a woman's bust points ~18 cm.
//
// The interface SKIN7 consumes (review/studio_human_c8/after/skin7/NOTES.md 4b; likeness/skin.js applySkin, rev 7 only, by default):
//   import { nippleAt } from '../body/nipple.js';
//   const N = nippleAt(h, { sex, scale });   // h: a Hero (lib/fx/hero.js) AFTER the body layers (its body geometry's bind positions);
//   // scale: bind units per metre (1 / h.scale); N = { L: [x,y,z], R: [x,y,z], r, source, check } in the geometry's bind space, L on the +x side
//   // (the side of hm08 vertex 8471), r the areola radius in bind units. Never null: if the anatomy cannot be read it returns the fixed vertices
//   // with source 'landmark' (and says why in check.why), so an areola never silently vanishes (the orchestrator's 04:58 evidence on L03).
// It is a pure read of the geometry (sync), nothing is drawn and nothing in the hero changes.
//
// THE RULE (fractions of stature H from ANSUR II, BMI 19.5-27, read 8 Oct; the internipple / chest-breadth ratios are OUR reading of the literature):
//   height: ANSUR II chest height (the nipple in men, the bust point in women) below the person's own sternal notch: suprasternale - chest height =
//           0.0817 H (men), 0.0952 H (women), so the level follows the person's own torso, not hm08's
//   men:    half the internipple distance = 0.0575 H (20.2 cm at 1.76 m, the adult male mean), never inside the clavicle's midpoint (the
//           midclavicular line); the point is the front surface there (the pectoral's lower-lateral contour, 4th intercostal space). (The torso's
//           own breadth at that level was tried first: in the A-pose bind it holds the axillary folds, 37-40 cm on our men against ANSUR's 27.9.)
//   women:  the bust point: 0.056 H from the midline (bust points ~18 cm apart at 1.64 m), at the level where that column of her own mound is
//           most anterior (searched from 0.02 H above to 0.05 H below ANSUR's level: it follows her mound and its ptosis), on the front surface.
//           Not 'the most anterior point of the mound': on our SOMA women the chest's front is one shelf (the front surface 3 cm from the midline
//           is as far forward as at 10 cm, z 12.6-14.0 cm against the notch's 4.9: no cleavage gap, no apex of its own; SOMA's scans were taken
//           in bras), so an apex search lands anywhere on it. That shelf is a FORM fault of the breast (BODY7 next iterations), not the nipple's.
const ids = { suprasternale: 1524, clavicleMidL: 8090, clavicleMidR: 1398, nippleL: 8471, nippleR: 1799, vertex: 881 };   // hm08 landmarks (assets/body/basis.json)
export const NIPPLE7 = { m: { below: 0.0817, half: 0.0575, r: 0.0135 }, f: { below: 0.0952, half: 0.056, r: 0.019 }, window: { x: 0.006, up: 0.02, down: 0.05 } };
export const NIPPLE7_VERSION = 2;   // 2 (c2 iteration 2): only vertices that belong to a triangle are read (hm08 keeps loose vertices in the torso region: on
                                     // L21 one sat 2.6 mm from the men's rule point and gave the point's depth); 1 read every torso vertex
const TORSO = 2;
const _used = new WeakMap();
function usedOf(g) { const I = g?.index?.array; if (!I) return null; let U = _used.get(g); if (U && U.nI === I.length) return U.m; const m = new Uint8Array(g.attributes.position.count); for (let i = 0; i < I.length; i++) m[I[i]] = 1; _used.set(g, { m, nI: I.length }); return m; }

export function nippleAt(h, { sex = h?.sex || 'm', scale = 1, stature = null } = {}) {
  const g = h?.body?.geometry, P = g?.attributes?.position?.array, A = g?.attributes?.aHero, R = A?.array, st = A?.itemSize || 4, K = NIPPLE7[sex === 'f' ? 'f' : 'm'];
  const at = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const fixed = why => ({ L: at(ids.nippleL), R: at(ids.nippleR), r: K.r * scale, source: 'landmark', check: { why } });
  if (!P || !R) return P ? fixed('no region attribute') : null;
  const U = usedOf(g);
  try {
    const n = P.length / 3, H = (stature ?? h.o?.height ?? 1.7) * scale, sn = at(ids.suprasternale), mid = sn[0], sideL = Math.sign(P[ids.nippleL * 3] - mid) || 1;
    const yT = sn[1] - K.below * H;
    // the torso's own breadth at that level (region 2 only: the arms are not in it), from the vertices within 1 cm of the level
    let xl = -Infinity, xr = Infinity; for (let v = 0; v < n; v++) { if (R[v * st] !== TORSO || (U && !U[v])) continue; if (Math.abs(P[v * 3 + 1] - yT) > 0.01 * scale) continue; const x = P[v * 3] - mid; if (x > xl) xl = x; if (x < xr) xr = x; }
    if (!isFinite(xl) || !isFinite(xr)) return fixed('no torso at the chest level');
    const breadth = xl - xr, out = { r: K.r * scale, check: { H: +(H / scale).toFixed(3), breadth: +(breadth / scale).toFixed(4), level: +((sn[1] - yT) / scale).toFixed(4) } };
    let src = 'anatomy';
    for (const [key, sgn] of [['L', sideL], ['R', -sideL]]) {
      const cm = at(ids[sgn === sideL ? 'clavicleMidL' : 'clavicleMidR']), mcl = Math.abs(cm[0] - mid);
      let xT = Math.max(K.half * H, sex === 'f' ? 0 : mcl), p = null;
      // v2: the point's depth is the front surface itself, where a ray along +z through (x0, y0) leaves the torso's front triangles (v1 took the
      // front-most vertex within 1.2 cm, which on a sloping pectoral stands 3-6 mm proud of the skin at the point); the vertex read is the fallback
      const ray = (x0, y0) => { const I = g.index.array; let zb = -Infinity;
        for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; if (R[a * st] !== TORSO || R[b * st] !== TORSO || R[c * st] !== TORSO) continue;
          const ax = P[a * 3] - x0, ay = P[a * 3 + 1] - y0, bx = P[b * 3] - x0, by = P[b * 3 + 1] - y0, cx = P[c * 3] - x0, cy = P[c * 3 + 1] - y0;
          if ((ax > 0 && bx > 0 && cx > 0) || (ax < 0 && bx < 0 && cx < 0) || (ay > 0 && by > 0 && cy > 0) || (ay < 0 && by < 0 && cy < 0)) continue;
          const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay); if (Math.abs(d) < 1e-14) continue;
          const u = ((-ax) * (cy - ay) - (cx - ax) * (-ay)) / d, w = ((bx - ax) * (-ay) - (-ax) * (by - ay)) / d; if (u < 0 || w < 0 || u + w > 1) continue;
          const z = P[a * 3 + 2] + u * (P[b * 3 + 2] - P[a * 3 + 2]) + w * (P[c * 3 + 2] - P[a * 3 + 2]); if (z > zb) zb = z; }
        return isFinite(zb) ? zb : null; };
      const front = (x0, y0, rad) => { const zr = ray(x0, y0); if (zr != null) return [x0, y0, zr]; let best = null; for (let v = 0; v < n; v++) { if (R[v * st] !== TORSO || (U && !U[v])) continue; const dx = P[v * 3] - x0, dy = P[v * 3 + 1] - y0; if (dx * dx + dy * dy > rad * rad) continue; if (!best || P[v * 3 + 2] > best[2]) best = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; } return best; };
      if (sex === 'f') {   // the bust point: at the rule's distance from the midline, the level where that column of the mound is most anterior
        const W = NIPPLE7.window, x0 = mid + sgn * xT; let zMax = -Infinity; const cand = [];
        for (let v = 0; v < n; v++) { if (R[v * st] !== TORSO || (U && !U[v])) continue; const x = P[v * 3], y = P[v * 3 + 1]; if (Math.abs(x - x0) > W.x * H || y > yT + W.up * H || y < yT - W.down * H) continue; cand.push(v); if (P[v * 3 + 2] > zMax) zMax = P[v * 3 + 2]; }
        let sy = 0, k = 0; for (const v of cand) if (P[v * 3 + 2] > zMax - 0.003 * scale) { sy += P[v * 3 + 1]; k++; }
        if (k) { const yA = sy / k, s2 = front(x0, yA, 0.012 * scale); if (s2) { p = [x0, yA, s2[2]]; out.check['drop' + key] = +((yT - yA) / H).toFixed(4); } }
        if (!p) src = 'rule';
      }
      if (!p) { const s = front(mid + sgn * xT, yT, 0.012 * scale); if (!s) return fixed('no front surface at the rule point'); p = [mid + sgn * xT, yT, s[2]]; }
      out[key] = p.map(x => +x.toFixed(5)); out.check['half' + key] = +(Math.abs(p[0] - mid) / H).toFixed(4); out.check['mcl' + key] = +(mcl / H).toFixed(4);
    }
    out.source = src; out.check.internipple = +(Math.abs(out.L[0] - out.R[0]) / scale).toFixed(4); out.check.fixedInternipple = +(Math.abs(P[ids.nippleL * 3] - P[ids.nippleR * 3]) / scale).toFixed(4);
    out.check.dFixedL = +(Math.hypot(...out.L.map((x, i) => x - at(ids.nippleL)[i])) / scale).toFixed(4);
    return out;
  } catch (e) { return fixed('error: ' + (e.message || e)); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// NAC7 (BODY7 c2 iteration 2, 8 Oct; rev 7.6): the nipple-areola complex IN THE GEOMETRY, where nippleAt puts it. The orchestrator's priority 2
// ('the nipple relief is still at hm08's fixed vertices: the small puckers ~1/4 chest width from the midline, in v6 and rev 7 alike').
// WHAT THE PUCKER IS (measured in node, 8 Oct): not a bump. hm08 models the nipple as a small dense patch (MakeHuman's form body: L21 72 vertices
// within 25 mm of vertex 8471, edges 0.7-1.2 mm at the papilla, no triangle turned); the learned prior bodies (MHR for men, SOMA for women) COLLAPSE
// that patch (their surfaces have no nipple): on the prior body 50 (L21) / 23 (L08) of its triangles fall under 0.5 mm2 and 16 / 20 turn over;
// once subdivided (the detail tier) 227 / 173 tiny and 123 / 100 turned triangles within 25 mm (73-80 triangles a side under a quarter of their
// form-body area on all six people probed, out to 27-31 mm on the men and 37-38 mm on the women). Smooth-shaded, that crumpled patch reads as a
// puckered scar at hm08's place (2.5-3.2 cm medial of the anatomical nipple), and nothing marks the anatomical place.
// THE CHANGE (two steps, on the body geometry's bind positions, at whatever level it is; applyDetail runs it for a rev 7 record):
//  1. relay: hm08's collapsed patch round each fixed vertex is laid out again (relay7v2 below: the region grown to the crumple's edge, a Tutte
//     layout in the tangent plane, heights from the chest's own surface, blended into the skin), so no crumple and no rim are left.
//  2. relief: at nippleAt's point (the same function SKIN7's painted areola reads, so colour and form coincide), a low areolar mound (radius
//     nippleAt's r: men 13.5 mm, women 19 mm) and the papilla (a Gaussian; sigma at least 0.8 of the local edge so the mesh carries it the same
//     way on every body and side), along ONE normal a side. Heights are OUR reading of the anatomy literature for the relaxed state (men: areola
//     ~flat, nipple 2-4 mm proud; women: areola raised 1-2 mm, nipple ~1 cm across and 4-9 mm proud): men 0.5 / 1.8 mm, women 1.0 / 3.5 mm.
// At the detail tier's resolution (5-7 mm between vertices on the chest) the papilla is a soft nub over one ring of vertices: what the mesh can
// carry; the finer form (the papilla's edge, Montgomery's tubercles, the areola's texture) is DETAIL7's fine tier (maps) on this landmark.
// nippleRelief7(h, { relay: false }) / { relief: false } do one step. (c3, 8 Oct: v1 = rev 7.6, the radius-disc relay with a quadratic cap and a
// one-vertex slide, is DELETED: superseded by v2; git history is its record.)
export const NAC7 = { version: 2, m: { patch: 0.014, areolaH: 0.0005, papH: 0.0018, papS: 0.003 }, f: { patch: 0.019, areolaH: 0.001, papH: 0.0035, papS: 0.0045 },   // patch: fraction of stature (the relay's starting radius)
  // v2 (BODY7 c2 iteration 3, rev 7.7): the relay reaches the crumple's edge and is blended into the skin (below, relay7v2); lengths in metres
  v2: { reach: 3.0, grow: 2.0, margin: 0.004, band: 0.008, sigma: 0.005, rounds: 10, sharp: 40, lap: 6, sweeps: 3000, weights: 'uniform', cover: 0.010 } };
// NAC7 v2 (BODY7 c2 iteration 3, 8 Oct; rev 7.7; the current and only relay). What the plates of rev 7.6 showed (the measurer's c2 it2 and the
// orchestrator's 14:25 read; measured again in node): v1's relay removed the crumple (sharp edges within 50 mm of hm08's vertex 100-154 -> 0-12 a side) but cut
// a RIM where the re-laid patch met the held ring: every edge left over 45 deg sits at the patch's edge (bind: men 25-30 mm, women 25-35 mm from the
// vertex), between a held vertex and a patch vertex the layout moved 2-7 mm, or between two held vertices whose triangle a moved vertex folded over. Two
// causes, both v1's: (1) the patch was a 3D-distance disc, so its held ring zig-zags (26 / 29.7 mm next to each other): not convex, so the Tutte layout
// (whose no-fold guarantee needs a convex ring) folds triangles there; (2) the patch's heights were one quadratic fitted to the ring, the ring kept its
// own heights: a step in slope all round (the men's 'flat disc with a hard rim', 5.5 cm across). v2 is mesh repair, no shape target:
//  1. the region: hm08's patch grown until it holds every defect of the prior body's surface near the vertex (a triangle folded in the tangent plane, a
//     tiny one, an edge over v2.sharp deg) with v2.margin to spare (at most v2.grow x the v1 radius); then, round by round, every held vertex of a
//     triangle that the layout folds or an edge it leaves over v2.sharp deg joins the patch and the layout is made again (the ring becomes convex
//     where it was not), until none is left (v2.rounds);
//  2. the layout: Tutte with MEAN-VALUE weights taken from hm08's own UV layout (positive, so still no fold inside a convex ring; and a layout that is
//     already an affine image of the UV, i.e. the healthy skin, is a fixed point: only the crumple moves), uniform where a UV triangle is degenerate;
//  3. the heights: the chest's own surface, not a quadratic: a robust moving-least-squares fit (local quadratic, Gaussian v2.sigma, Cauchy-weighted
//     residuals) of every vertex of the neighbourhood as it was (a collapsed vertex is still on the prior body's surface; a folded one is down-weighted),
//     read at each patch vertex's new place; a band v2.band wide OUTSIDE the patch blends from that surface to its own heights (smoothstep), and
//     v2.lap Laplacian steps on the height residual across the rim take out what is left of a kink (the residual, so the chest's curvature is kept);
//  4. the relief (step 2 of NAC7) is raised along ONE normal per side (the mean over the areola), not along each vertex's own normal.
// Cost ~0.2-0.6 s a figure (node, once). Nothing is drawn; v6 untouched.
const _adj = new WeakMap();
function adjOf(g) {
  let A = _adj.get(g); if (A && A.nI === g.index.array.length) return A;
  const I = g.index.array, n = g.attributes.position.count, deg = new Int32Array(n + 1), seen = new Set(), E = [];
  for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) { const k = a < b ? a * n + b : b * n + a; if (seen.has(k)) continue; seen.add(k); E.push(a, b); deg[a + 1]++; deg[b + 1]++; }
  for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
  const nb = new Int32Array(deg[n]), f = deg.slice(0, n); for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1]; nb[f[a]++] = b; nb[f[b]++] = a; }
  const td = new Int32Array(n + 1); for (let i = 0; i < I.length; i++) td[I[i] + 1]++; for (let v = 0; v < n; v++) td[v + 1] += td[v];
  const vt = new Int32Array(td[n]), tf = td.slice(0, n); for (let t = 0; t < I.length / 3; t++) for (let j = 0; j < 3; j++) vt[tf[I[3 * t + j]]++] = t;
  A = { off: deg, nb, toff: td, vt, nI: I.length }; _adj.set(g, A); return A;
}
// three's computeVertexNormals for the listed vertices only (area-weighted face normals, normalised): the rest of the body keeps its normals
function renormal(g, A, verts) {
  const X = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array;
  for (const v of verts) { let nx = 0, ny = 0, nz = 0;
    for (let k = A.toff[v]; k < A.toff[v + 1]; k++) { const t = A.vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ux = X[c] - X[b], uy = X[c + 1] - X[b + 1], uz = X[c + 2] - X[b + 2], wx = X[a] - X[b], wy = X[a + 1] - X[b + 1], wz = X[a + 2] - X[b + 2];
      nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nz += ux * wy - uy * wx; }
    const l = Math.hypot(nx, ny, nz) || 1; N[3 * v] = nx / l; N[3 * v + 1] = ny / l; N[3 * v + 2] = nz / l; }
}
function solveN(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; const d = M[i][i] || 1e-15;
    for (let j = i; j <= n; j++) M[i][j] /= d; for (let k = 0; k < n; k++) if (k !== i) { const f = M[k][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } }
  return M.map(r => r[n]); }

// NAC7 v2's relay of one side (the v2 note above NAC7): moves the bind positions of the patch and of the band round it, renormals them, returns its stats
function relay7v2(g, A, f, K, H, scale, torso, o, touched) {
  const X = g.attributes.position.array, NRM = g.attributes.normal.array, I = g.index.array, n = X.length / 3, UVa = g.attributes.uv?.array;
  const mm = x => +(x / scale * 1000).toFixed(2), R0 = K.patch * H, Rn = o.reach * R0, c0 = [X[3 * f], X[3 * f + 1], X[3 * f + 2]];
  const d3 = v => Math.hypot(X[3 * v] - c0[0], X[3 * v + 1] - c0[1], X[3 * v + 2] - c0[2]);
  // the neighbourhood: torso vertices joined to the vertex within Rn; 'inner' = every neighbour in it too (only those may move)
  const inN = new Uint8Array(n), NV = [f]; inN[f] = 1;
  for (let i = 0; i < NV.length; i++) { const v = NV[i]; for (let k = A.off[v]; k < A.off[v + 1]; k++) { const u = A.nb[k]; if (inN[u] || !torso(u) || d3(u) >= Rn) continue; inN[u] = 1; NV.push(u); } }
  if (NV.length < 30) return { skipped: 'neighbourhood ' + NV.length };
  const inner = new Uint8Array(n); for (const v of NV) { let ok = true; for (let k = A.off[v]; k < A.off[v + 1]; k++) if (!inN[A.nb[k]]) { ok = false; break; } inner[v] = ok ? 1 : 0; }
  // the frame: the mean normal of the neighbourhood's outer (healthy) part
  let nx = 0, ny = 0, nz = 0; for (const v of NV) { if (d3(v) < 1.2 * R0) continue; nx += NRM[3 * v]; ny += NRM[3 * v + 1]; nz += NRM[3 * v + 2]; }
  const nl = Math.hypot(nx, ny, nz); if (!(nl > 0)) return { skipped: 'no frame' };
  const nn = [nx / nl, ny / nl, nz / nl]; let t1 = [1 - nn[0] * nn[0], -nn[0] * nn[1], -nn[0] * nn[2]]; const tl = Math.hypot(...t1) || 1; t1 = t1.map(x => x / tl);
  const t2 = [nn[1] * t1[2] - nn[2] * t1[1], nn[2] * t1[0] - nn[0] * t1[2], nn[0] * t1[1] - nn[1] * t1[0]];
  // local coordinates (u, w in the tangent plane, z along nn): O as the surface is, L as it is being made
  const O = new Float64Array(3 * n), L = new Float64Array(3 * n);
  for (const v of NV) { const d = [X[3 * v] - c0[0], X[3 * v + 1] - c0[1], X[3 * v + 2] - c0[2]]; O[3 * v] = d[0] * t1[0] + d[1] * t1[1] + d[2] * t1[2]; O[3 * v + 1] = d[0] * t2[0] + d[1] * t2[1] + d[2] * t2[2]; O[3 * v + 2] = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]; }
  const rp = (Q, v) => Math.hypot(Q[3 * v], Q[3 * v + 1]);
  // its triangles, and its edges with their two faces
  const TN = []; for (let t = 0; t < I.length / 3; t++) if (inN[I[3 * t]] && inN[I[3 * t + 1]] && inN[I[3 * t + 2]]) TN.push(t);
  const EF = new Map(); for (const t of TN) for (const [a, b] of [[I[3 * t], I[3 * t + 1]], [I[3 * t + 1], I[3 * t + 2]], [I[3 * t + 2], I[3 * t]]]) { const k = a < b ? a * n + b : b * n + a; const e = EF.get(k); if (e) e.push(t); else EF.set(k, [t]); }
  const EL = []; for (const [k, fs] of EF) if (fs.length === 2) EL.push([Math.floor(k / n), k % n, fs[0], fs[1]]);
  const mm2 = 0.5e-6 * scale * scale, cosS = Math.cos(o.sharp * Math.PI / 180), cos60 = 0.5;
  // health on local coordinates Q (the frame is orthonormal and right-handed, so a face normal's z is the triangle's signed area in the plane):
  // folded in the plane, tiny (< 0.5 mm2), edges over o.sharp / 60 deg; 'only' = a mask: count what touches it (null: all within rMax in the plane)
  const health = (Q, only, rMax = Infinity) => {
    const fo = new Map(), badV = new Set(); let folded = 0, tiny = 0, sharp = 0, s60 = 0;
    const take = (...vs) => only ? vs.some(v => only[v]) : vs.every(v => rp(Q, v) < rMax);
    for (const t of TN) { const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      const ux = Q[3 * b] - Q[3 * a], uy = Q[3 * b + 1] - Q[3 * a + 1], uz = Q[3 * b + 2] - Q[3 * a + 2], wx = Q[3 * c] - Q[3 * a], wy = Q[3 * c + 1] - Q[3 * a + 1], wz = Q[3 * c + 2] - Q[3 * a + 2];
      const N3 = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx], ar = Math.hypot(...N3) || 1e-30; fo.set(t, [N3[0] / ar, N3[1] / ar, N3[2] / ar]);
      if (!take(a, b, c)) continue; if (N3[2] <= 0) { folded++; badV.add(a); badV.add(b); badV.add(c); } if (0.5 * ar < mm2) tiny++; }
    for (const [p, q, f1, f2] of EL) { if (!take(p, q)) continue; const A1 = fo.get(f1), A2 = fo.get(f2), cs = A1[0] * A2[0] + A1[1] * A2[1] + A1[2] * A2[2];
      if (cs < cosS) { sharp++; badV.add(p); badV.add(q); } if (cs < cos60) s60++; }
    return { folded, tiny, sharp, s60, badV };
  };
  const cap = o.grow * R0, h0 = health(O, null, cap);
  let dDef = 0; for (const v of h0.badV) { const r = rp(O, v); if (r < cap) dDef = Math.max(dDef, r); }
  // and, when o.cover is set, far enough to hold nippleAt's point (o.q, read before the relay) by o.cover: the layout then spreads hm08's dense nipple rings over it
  let qR = 0; if (o.q && o.cover != null) { const d = [o.q[0] - c0[0], o.q[1] - c0[1], o.q[2] - c0[2]]; qR = Math.hypot(d[0] * t1[0] + d[1] * t1[1] + d[2] * t1[2], d[0] * t2[0] + d[1] * t2[1] + d[2] * t2[2]) + o.cover * scale; }
  const Rg = Math.min(cap, Math.max(R0, dDef + o.margin * scale, qR));
  const inP = new Uint8Array(n); { const q = [f]; inP[f] = 1; for (let i = 0; i < q.length; i++) { const v = q[i]; for (let k = A.off[v]; k < A.off[v + 1]; k++) { const u = A.nb[k]; if (!inner[u] || inP[u] || rp(O, u) >= Rg) continue; inP[u] = 1; q.push(u); } } }
  // the layout's weights: mean-value coordinates of each vertex's 1-ring in hm08's UV layout (positive), uniform where the UV fan is not a clean star
  const Wt = new Map(); let uvOK = 0, uvUni = 0;
  const weightsOf = v => { let ws = Wt.get(v); if (ws) return ws; const acc = new Map(); let ok = !!UVa && o.weights !== 'uniform', sg = 0;
    if (ok) for (let k = A.toff[v]; k < A.toff[v + 1]; k++) { const t = A.vt[k], tri = [I[3 * t], I[3 * t + 1], I[3 * t + 2]], i0 = tri.indexOf(v), j = tri[(i0 + 1) % 3], l = tri[(i0 + 2) % 3];
      const ej = [UVa[2 * j] - UVa[2 * v], UVa[2 * j + 1] - UVa[2 * v + 1]], el = [UVa[2 * l] - UVa[2 * v], UVa[2 * l + 1] - UVa[2 * v + 1]], lj = Math.hypot(ej[0], ej[1]), ll = Math.hypot(el[0], el[1]), cr = ej[0] * el[1] - ej[1] * el[0];
      if (!(lj > 1e-9 && ll > 1e-9) || Math.abs(cr) < 1e-14 || (sg && Math.sign(cr) !== sg)) { ok = false; break; } sg = Math.sign(cr);
      const th = Math.tan(0.5 * Math.acos(Math.max(-1, Math.min(1, (ej[0] * el[0] + ej[1] * el[1]) / (lj * ll)))));
      acc.set(j, (acc.get(j) || 0) + th / lj); acc.set(l, (acc.get(l) || 0) + th / ll); }
    if (ok && acc.size !== A.toff[v + 1] - A.toff[v]) ok = false;   // an open fan (a seam): uniform
    if (!ok) { acc.clear(); for (let k = A.off[v]; k < A.off[v + 1]; k++) acc.set(A.nb[k], 1); uvUni++; } else uvOK++;
    let sw = 0; for (const w of acc.values()) sw += w; ws = [...acc].map(([u, w]) => [u, w / sw]); Wt.set(v, ws); return ws; };
  // the surface: a robust moving-least-squares height over the plane from the neighbourhood as it was (a grid of cells 3 sigma wide)
  const sig = o.sigma * scale, cell = 3 * sig, grid = new Map(), gk = (a, b) => a * 100003 + b;
  for (const v of NV) { const k = gk(Math.floor(O[3 * v] / cell), Math.floor(O[3 * v + 1] / cell)); const c = grid.get(k); if (c) c.push(v); else grid.set(k, [v]); }
  const mlsCache = new Map();
  const mls = (u0, w0) => { const key = u0.toFixed(9) + ',' + w0.toFixed(9); if (mlsCache.has(key)) return mlsCache.get(key);
    const S = [], gi = Math.floor(u0 / cell), gj = Math.floor(w0 / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const v of grid.get(gk(gi + a, gj + b)) || []) { const du = (O[3 * v] - u0) / sig, dw = (O[3 * v + 1] - w0) / sig, r2 = du * du + dw * dw; if (r2 < 9) S.push([du, dw, O[3 * v + 2], Math.exp(-r2)]); }
    if (S.length < 8) { mlsCache.set(key, null); return null; }
    let cf = null;
    for (let pass = 0; pass < 3; pass++) { const M = Array.from({ length: 6 }, () => new Array(6).fill(0)), rhs = new Array(6).fill(0);
      for (const s of S) { const [du, dw, z, w0_] = s; let w = w0_; if (cf) { const r = z - (cf[0] + cf[1] * du + cf[2] * dw + cf[3] * du * du + cf[4] * du * dw + cf[5] * dw * dw); w /= 1 + (r / (0.0003 * scale)) ** 2; }
        const bs = [1, du, dw, du * du, du * dw, dw * dw]; for (let i = 0; i < 6; i++) { rhs[i] += w * bs[i] * z; for (let j = 0; j < 6; j++) M[i][j] += w * bs[i] * bs[j]; } }
      for (let i = 0; i < 6; i++) M[i][i] += 1e-9; cf = solveN(M, rhs); }
    mlsCache.set(key, cf[0]); return cf[0]; };
  const B = o.band * scale; let round = 0, sweepsUsed = 0, hl = null, changed = null, nBand = 0, PV = null;
  for (; round < o.rounds; round++) {
    L.set(O); PV = NV.filter(v => inP[v]);
    // 1. the layout (Gauss-Seidel, over-relaxed), the vertices outside the patch held where they are
    let it = 0; for (; it < o.sweeps; it++) { let res = 0; for (const v of PV) { let su = 0, sw = 0; for (const [u, w] of weightsOf(v)) { su += w * L[3 * u]; sw += w * L[3 * u + 1]; }
        const du = su - L[3 * v], dw = sw - L[3 * v + 1]; L[3 * v] += 1.5 * du; L[3 * v + 1] += 1.5 * dw; res = Math.max(res, Math.abs(du), Math.abs(dw)); } if (res < 1e-8 * scale) break; }
    sweepsUsed = it;
    // 2. heights: the patch on the surface; the band outside it blends from the surface to its own heights
    for (const v of PV) { const z = mls(L[3 * v], L[3 * v + 1]); if (z != null) L[3 * v + 2] = z; }
    const pr = Math.max(...PV.map(v => rp(L, v))), bandW = new Map();
    for (const v of NV) { if (inP[v] || !inner[v] || rp(O, v) > pr + B) continue; let dm = Infinity; for (const u of PV) { const d = Math.hypot(L[3 * u] - O[3 * v], L[3 * u + 1] - O[3 * v + 1]); if (d < dm) dm = d; }
      if (dm >= B) continue; const t = dm / B, w = 1 - t * t * (3 - 2 * t); const z = mls(O[3 * v], O[3 * v + 1]); if (z == null) continue; L[3 * v + 2] = O[3 * v + 2] + w * (z - O[3 * v + 2]); bandW.set(v, w); }
    nBand = bandW.size;
    // 3. Laplacian steps on the height residual (z minus the surface) across the rim: the band and the patch's two outer rings
    const zone = new Set(bandW.keys()); for (const v of PV) for (let k = A.off[v]; k < A.off[v + 1]; k++) if (!inP[A.nb[k]]) { zone.add(v); for (let k2 = A.off[v]; k2 < A.off[v + 1]; k2++) if (inP[A.nb[k2]]) zone.add(A.nb[k2]); break; }
    const res = new Map(), surfAt = v => mls(L[3 * v], L[3 * v + 1]);
    const resOf = v => { if (res.has(v)) return res.get(v); const s = surfAt(v); const r = s == null ? 0 : L[3 * v + 2] - s; res.set(v, r); return r; };
    for (const v of zone) for (let k = A.off[v]; k < A.off[v + 1]; k++) resOf(A.nb[k]); for (const v of zone) resOf(v);
    for (let s = 0; s < o.lap; s++) { const nr = new Map(); for (const v of zone) { let m = 0, c = 0; for (let k = A.off[v]; k < A.off[v + 1]; k++) { m += res.get(A.nb[k]) ?? 0; c++; } nr.set(v, 0.5 * res.get(v) + 0.5 * m / Math.max(1, c)); } for (const [v, r] of nr) res.set(v, r); }
    for (const v of zone) { const sf = surfAt(v); if (sf != null) L[3 * v + 2] = sf + res.get(v); }
    // 4. what is left: folds and sharp edges touching anything moved; their held vertices join the patch and the layout is made again
    changed = new Uint8Array(n); for (const v of PV) changed[v] = 1; for (const v of zone) changed[v] = 1;
    hl = health(L, changed);
    if (!hl.folded && !hl.sharp) break;
    let added = 0; for (const v of hl.badV) if (!inP[v] && inner[v] && rp(O, v) < cap + B) { inP[v] = 1; added++; }
    if (!added) break;
  }
  // write back, renormal what moved and its ring
  let moved = 0, reach = 0; const ring = new Set();
  for (const v of NV) { if (!changed[v]) continue; const u = L[3 * v], w = L[3 * v + 1], z = L[3 * v + 2];
    const p = [c0[0] + u * t1[0] + w * t2[0] + z * nn[0], c0[1] + u * t1[1] + w * t2[1] + z * nn[1], c0[2] + u * t1[2] + w * t2[2] + z * nn[2]];
    const d = Math.hypot(p[0] - X[3 * v], p[1] - X[3 * v + 1], p[2] - X[3 * v + 2]); if (d > 0) { moved = Math.max(moved, d); reach = Math.max(reach, d3(v)); }
    X[3 * v] = p[0]; X[3 * v + 1] = p[1]; X[3 * v + 2] = p[2]; ring.add(v); for (let k = A.off[v]; k < A.off[v + 1]; k++) ring.add(A.nb[k]); }
  renormal(g, A, ring); for (const v of ring) touched.add(v);
  const pick = q => ({ turned: q.folded, tiny: q.tiny, sharp: q.sharp, over60: q.s60 });
  return { vertex: f, v: 2, patch: PV.length, band: nBand, radiusMm: mm(R0), grownMm: mm(Rg), defectMm: mm(dDef), reachMm: mm(reach), rounds: round + 1, sweeps: sweepsUsed, maxMoveMm: mm(moved),
    uv: { mvc: uvOK, uniform: uvUni }, before: pick(health(O, changed)), after: pick(hl), frame: nn.map(x => +x.toFixed(4)) };
}

export function nippleRelief7(h, { sex = h?.sex || 'm', scale = 1, stature = null, relay = true, relief = true, v2 = {}, ...over } = {}) {
  const g = h?.body?.geometry, X = g?.attributes?.position?.array, NRM = g?.attributes?.normal?.array, AH = g?.attributes?.aHero; if (!X || !NRM || !g.index) return null;
  const t0 = Date.now(), REG = AH?.array, st = AH?.itemSize || 4, A = adjOf(g), n = X.length / 3, H = (stature ?? h.o?.height ?? 1.7) * scale, K = { ...NAC7[sex === 'f' ? 'f' : 'm'], ...over };
  const out = { version: NAC7.version, sex, relay: {}, relief: {} }, mm = x => +(x / scale * 1000).toFixed(2), mm2 = 0.5e-6 * scale * scale, touched = new Set();
  const used = usedOf(g), torso = v => (!REG || REG[v * st] === TORSO) && (!used || used[v]);
  const P = v => [X[3 * v], X[3 * v + 1], X[3 * v + 2]];
  if (relay) { const o2 = { ...NAC7.v2, ...v2 }, Q0 = o2.cover != null ? nippleAt(h, { sex, scale, stature }) : null;
    for (const [key, f] of [['L', ids.nippleL], ['R', ids.nippleR]]) out.relay[key] = relay7v2(g, A, f, K, H, scale, torso, { ...o2, q: Q0 && Q0.source !== 'landmark' ? Q0[key] : null }, touched); }
  if (relief) {
    const NP = nippleAt(h, { sex, scale, stature }); out.relief.source = NP?.source; out.relief.r = NP ? mm(NP.r) : null;
    if (NP && NP.source !== 'landmark') for (const key of ['L', 'R']) {
      const q = NP[key], rA = NP.r, reach = 1.4 * rA; let near = [], vbest = -1, dbest = Infinity;
      for (let v = 0; v < n; v++) { if (!torso(v)) continue; const d = Math.hypot(X[3 * v] - q[0], X[3 * v + 1] - q[1], X[3 * v + 2] - q[2]); if (d < reach) near.push(v); if (d < dbest) { dbest = d; vbest = v; } }
      if (!near.length) { out.relief[key] = { skipped: 'no surface' }; continue; }
      let nx = 0, ny = 0, nz = 0; for (const v of near) { nx += NRM[3 * v]; ny += NRM[3 * v + 1]; nz += NRM[3 * v + 2]; } const nl = Math.hypot(nx, ny, nz) || 1, nn = [nx / nl, ny / nl, nz / nl];
      // the local edge (mean over the nearest vertex's edges) sets how wide a papilla the mesh can carry
      let el = 0, ec = 0; for (let k = A.off[vbest]; k < A.off[vbest + 1]; k++) { const u = A.nb[k]; el += Math.hypot(X[3 * u] - X[3 * vbest], X[3 * u + 1] - X[3 * vbest + 1], X[3 * u + 2] - X[3 * vbest + 2]); ec++; } el /= Math.max(1, ec);
      // the papilla's top on a vertex: the vertex nearest the point (along the surface) slides onto it, all the way or half way, whichever turns
      // none of its triangles, so the peak sits on the point whatever the grid (the mesh's 2-6 mm spacing otherwise leaves it 1-3 mm off)
      let snapMm = 0; { let vb = -1, tb = Infinity, tvb = null; for (const v of near) { const d = [X[3 * v] - q[0], X[3 * v + 1] - q[1], X[3 * v + 2] - q[2]], dn = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2], tv = [d[0] - dn * nn[0], d[1] - dn * nn[1], d[2] - dn * nn[2]], tl = Math.hypot(...tv); if (tl < tb) { tb = tl; vb = v; tvb = tv; } }
        const I = g.index.array, okTris = v => { for (let k = A.toff[v]; k < A.toff[v + 1]; k++) { const t = A.vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
            const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], wx = X[c] - X[a], wy = X[c + 1] - X[a + 1], wz = X[c + 2] - X[a + 2];
            if ((uy * wz - uz * wy) * nn[0] + (uz * wx - ux * wz) * nn[1] + (ux * wy - uy * wx) * nn[2] <= 0) return false; } return true; };
        // v2: not one vertex but the areola's skin is drawn toward the point, a smooth tangential warp (1 at that vertex, smoothstep to 0 at rW), so
        // the papilla stands on well-shaped triangles (v1's single slide left thin ones there: the edges over 60 deg the measurer found at the nub)
        if (vb >= 0 && tb > 0) { const rW = Math.min(1.3 * rA, Math.max(0.8 * rA, 4 * tb)), pb = P(vb), wv = [];
          for (const v of near) { const d = [X[3 * v] - pb[0], X[3 * v + 1] - pb[1], X[3 * v + 2] - pb[2]], dn = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2], rho = Math.hypot(d[0] - dn * nn[0], d[1] - dn * nn[1], d[2] - dn * nn[2]);
            if (rho >= rW) continue; const t = rho / rW; wv.push([v, 1 - t * t * (3 - 2 * t), P(v)]); }
          for (const f of [1, 0.5, 0.25]) { for (const [v, w, p0] of wv) for (let j = 0; j < 3; j++) X[3 * v + j] = p0[j] - f * w * tvb[j];
            if (wv.every(([v]) => okTris(v))) { snapMm = mm(f * tb); break; } for (const [v, , p0] of wv) for (let j = 0; j < 3; j++) X[3 * v + j] = p0[j]; } } }
      const sP = Math.max(K.papS * scale, 0.8 * el), hA = K.areolaH * scale, hP = K.papH * scale; let dmax = 0, vmax = -1; const disp = [];
      for (const v of near) { const d = [X[3 * v] - q[0], X[3 * v + 1] - q[1], X[3 * v + 2] - q[2]], dn = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2], rho = Math.hypot(d[0] - dn * nn[0], d[1] - dn * nn[1], d[2] - dn * nn[2]);
        const tA = Math.min(1, Math.max(0, (rho - 0.65 * rA) / (0.45 * rA))), a = hA * (1 - tA * tA * (3 - 2 * tA)) + hP * Math.exp(-((rho / sP) ** 2)); if (a <= 1e-6 * scale) continue; disp.push([v, a]); if (a > dmax) { dmax = a; vmax = v; } }
      // where the relief sits (tangential distance from the point): its displacement-weighted centre and its highest vertex
      const tang = p => { const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]], dn = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]; return Math.hypot(d[0] - dn * nn[0], d[1] - dn * nn[1], d[2] - dn * nn[2]); };
      let cw = 0; const cc = [0, 0, 0]; for (const [v, a] of disp) { cw += a; cc[0] += a * X[3 * v]; cc[1] += a * X[3 * v + 1]; cc[2] += a * X[3 * v + 2]; } const centreMm = cw ? mm(tang(cc.map(x => x / cw))) : null, peakTMm = vmax >= 0 ? mm(tang(P(vmax))) : null;
      for (const [w, a] of disp) { const d = nn; X[3 * w] += a * d[0]; X[3 * w + 1] += a * d[1]; X[3 * w + 2] += a * d[2]; }   // one normal a side
      const ringR = new Set(); for (const [v] of disp) { ringR.add(v); for (let k = A.off[v]; k < A.off[v + 1]; k++) ringR.add(A.nb[k]); } renormal(g, A, ringR); for (const v of ringR) touched.add(v);
      out.relief[key] = { at: q.map(x => +x.toFixed(5)), vertices: disp.length, edgeMm: mm(el), papSigmaMm: mm(sP), peakMm: mm(dmax), snapMm, centreMm, peakTMm };
    }
    out.nipple = NP;
  }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; out.touched = touched.size; out.ms = Date.now() - t0;
  return out;
}
