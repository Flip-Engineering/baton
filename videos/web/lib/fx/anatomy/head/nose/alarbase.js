// NOSE AND MOUTH (c3, iteration 1, 15 Oct): THE SKIN AT THE ALAR BASE AS A SHELL. The first defect on every face (DETAIL7's i14 boards, the
// orchestrator's 15 Oct read): a jagged NOTCH at the base of the nostril beside the alar groove (L08, L22). Its cause is in the person's skin
// itself, before any morph: hm08's nostril meets the alar rim and the sill at its lateral corner in a PINCH (control edges 324-325 / 7086-7087
// fold 86 deg on hm08 neutral, 81 deg on L08's face; at Loop level 1 a fan of slivers and 61 deg edges: labs/nosemouth/nm_scratch probes,
// NOTES c3 it1). A real alar base has no such pinch: the skin is a continuous shell of finite thickness over the fibrofatty lobule; it
// rolls round the alar rim into the vestibule, runs over the sill onto the lip, and is tethered (not folded) into the alar-facial groove
// (Oneal and Beil 2010, the alar lobule as fibrofatty tissue with no cartilage at the rim; Lessard and Daniel 1985 and Rohrich 2003 for
// the envelope's thickness). A shell of thickness t cannot bend tighter than a radius of about t: the dermis would have to crush.
// THE MODEL, here: the skin of the alar base and the nostril's margin as such a shell. Its least radius is the person's own alar envelope
// (nose/params.js env.ala: by population and sex, the thick-skin factor of the African, East Asian and mestizo noses, + age); wherever the
// person's surface bends tighter than that (the curvature across an edge: its dihedral over the distance between its two faces' centres)
// the shell relaxes: the over-bent faces' vertices move toward their rings' means, a Taubin pair (lambda | mu) so the lobule keeps its
// volume, again until no edge is over-bent (or a cap of rounds). Every geometry the person draws (the control mesh and each subdivided
// level) is relaxed on its own spacing, so the limit is the same physical radius at every level; CORRECT5's corrected-bind base moves with
// its geometry. Holds for ANY person (no bake, no per-person value): the region is found from the person's own alare, the limit from the
// person's own sex, age and background. Nothing elsewhere changes (only over-bent edges within the alar base's reach move).
// What it is NOT (honest): the anatomy's nose wrapped on the person (wrap.js, iteration 2): on 8 Oct its folds at the sill made a worse
// nose than the person's own (c3 it1 node: 296 sharp edges in the window against the person's 13). This is the skin's own mechanics on the
// person's current geometry: it removes the pinch; it does not yet give the alar base the anatomy's form.
//   alarBase7(P, { name, rMin?, reach?, rounds? }) -> report    (the person slot 'nosemouth': { module: 'anatomy/head/nose/alarbase.js', fn: 'alarBase7' })
import { noseParams } from './params.js';
import { renormal, vertexNormals, innerVertices } from './wrap.js';
export const ALARBASE_VERSION = 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
let _ids = null;
async function ids() { if (_ids) return _ids; const FC = await import('../../../face/index.js'); const F = await FC.loadFaceStudio(); return (_ids = F.ids); }

// solve one geometry: X (positions, bind metres, length n*3), tri (index), segs [[a, b]] (per side: the alare and the lobule's end toward
// the tip, metres), o { r (m), reach (m: the capsule's radius round each segment), rounds }
// THE SHELL'S MECHANICS (rev 2, c3 it2): a position-based solve (Mueller et al. 2007, 'Position based dynamics', J Vis Commun Image
// Represent 18:109; the bending-limit form of Bridson et al. 2003's hinge) of three things the skin is: a membrane that keeps its own
// edge lengths (it does not stretch or shrink: the lobule's area and so its volume stay), a hinge at every edge that may bend up to the
// shell's limit (dihedral <= the faces' rest distance / r) and is NOT acted on below it, and the region's border and the vestibule's tube
// held where they are (the shell is tethered there). Rev 1 smoothed the over-bent faces toward their rings' means (a Taubin pair): it
// moved the pinch along the crease rather than opening it, and smoothing acts on every bend, so it could soften the real alar-facial
// groove too (the c3 it1 critic's caution). Here only an edge over the limit is pushed, and only by what it is over: a groove whose bend
// is within what a skin of thickness r can make keeps its depth.
export function relaxAlarBase(X, tri, n, segs, o) {
  const r = o.r, reach = o.reach, R2 = reach * reach, inR = new Uint8Array(n);
  const segD2 = (v, A, B) => { let ax = B[0] - A[0], ay = B[1] - A[1], az = B[2] - A[2], px = X[v * 3] - A[0], py = X[v * 3 + 1] - A[1], pz = X[v * 3 + 2] - A[2];
    const t = clamp((px * ax + py * ay + pz * az) / (ax * ax + ay * ay + az * az || 1e-12), 0, 1); px -= t * ax; py -= t * ay; pz -= t * az; return px * px + py * py + pz * pz; };
  let nR = 0; for (let v = 0; v < n; v++) for (const [A, B] of segs) if (segD2(v, A, B) < R2) { inR[v] = 1; nR++; break; }
  // the VESTIBULE's lining (hm08's nostril tunnel: a vertex whose normal meets the skin again) is not the shell's outer surface: held;
  // the rim (an edge from outer to inner) is the skin rolling into the vestibule. The underside (the nostril's floor and opening seen from
  // below) is not judged but moves with the shell.
  const list = []; for (let v = 0; v < n; v++) if (inR[v]) list.push(v);
  const Xmm = new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) Xmm[i] = X[i] * 1000;   // (wrap.js' ray test works in mm)
  const Nmm = vertexNormals(Xmm, tri, n), inner = innerVertices(Xmm, tri, n, Nmm, list, reach * 750);
  const tube = inner;   // (c3 it3: rev 2 carried a normal-direction test after this line that only fed the report's count, never the solve: removed)
  const F = []; for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a < n && b < n && c < n && (inR[a] || inR[b] || inR[c])) F.push(a, b, c); }
  const EF = new Map(); for (let f = 0; f < F.length; f += 3) for (let q = 0; q < 3; q++) { const a = F[f + q], b = F[f + (q + 1) % 3], key = a < b ? a * 4194304 + b : b * 4194304 + a; (EF.get(key) || EF.set(key, []).get(key)).push(f); }
  // free: in the region, not the tube, not on the region's border (a vertex with a neighbour outside: the tether)
  const free = new Uint8Array(n); for (const v of list) if (!tube[v]) free[v] = 1;
  for (const [key] of EF) { const a = Math.floor(key / 4194304), b = key % 4194304; if (!inR[a]) free[b] = 0; if (!inR[b]) free[a] = 0; }
  const X0 = Float64Array.from(X.subarray ? X.subarray(0, n * 3) : X.slice(0, n * 3));
  const P3 = (v) => [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]];
  // the hinges (edge a-b, wings c, d) and the membrane's edges with their rest lengths
  const H = [], Ed = [];
  for (const [key, fs] of EF) { const a = Math.floor(key / 4194304), b = key % 4194304;
    if (free[a] || free[b]) Ed.push(a, b, Math.hypot(X0[a * 3] - X0[b * 3], X0[a * 3 + 1] - X0[b * 3 + 1], X0[a * 3 + 2] - X0[b * 3 + 2]));
    if (fs.length !== 2) continue; const opp = (f) => [F[f], F[f + 1], F[f + 2]].find(v => v !== a && v !== b);
    const c = opp(fs[0]), d = opp(fs[1]); if (c === undefined || d === undefined) continue;
    const judged = inR[a] && inR[b] && !tube[a] && !tube[b];   // the underside (the nostril's floor and sill) moves with the shell, so it is judged too; only the tube is not
    const cc = [0, 1, 2].map(q => (X0[a * 3 + q] + X0[b * 3 + q] + X0[c * 3 + q]) / 3), cd = [0, 1, 2].map(q => (X0[a * 3 + q] + X0[b * 3 + q] + X0[d * 3 + q]) / 3);
    H.push({ a, b, c, d, f1: [F[fs[0]], F[fs[0] + 1], F[fs[0] + 2]], f2: [F[fs[1]], F[fs[1] + 1], F[fs[1] + 2]], judged, lim: Math.hypot(cc[0] - cd[0], cc[1] - cd[1], cc[2] - cd[2]) / r }); }
  const nrm = (p, q, s) => { const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], wx = s[0] - p[0], wy = s[1] - p[1], wz = s[2] - p[2]; return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; };
  const theta = (h) => { const n1 = nrm(P3(h.f1[0]), P3(h.f1[1]), P3(h.f1[2])), n2 = nrm(P3(h.f2[0]), P3(h.f2[1]), P3(h.f2[2])), l = Math.hypot(...n1) * Math.hypot(...n2); if (!l) return 0;
    return Math.acos(clamp((n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / l, -1, 1)); };   // the fold between the two faces' own (wound) normals
  const over = (h) => theta(h) - h.lim;
  const census = (keys = null) => { let c = 0, worst = 0; for (const h of H) { if (!h.judged) continue; const t = theta(h), k = t / h.lim; if (k > 1.0001) { c++; worst = Math.max(worst, k); if (keys && keys.length < 40) keys.push([h.a, h.b, +k.toFixed(2)]); } } return { c, worst }; };
  const keys0 = [], first = census(keys0); let last = first, rounds = 0;
  const eps = 2e-7, stiff = 0.6;
  while (last.c > 0 && rounds < (o.rounds ?? 60)) {
    for (const h of H) { if (!h.judged) continue; const C = over(h); if (C <= 0) continue;
      const vs = [h.a, h.b, h.c, h.d], G = []; let s2 = 0;
      for (const v of vs) { const g = [0, 0, 0]; if (free[v]) for (let q = 0; q < 3; q++) { const x = X[v * 3 + q]; X[v * 3 + q] = x + eps; const tp = theta(h); X[v * 3 + q] = x - eps; const tm = theta(h); X[v * 3 + q] = x; g[q] = (tp - tm) / (2 * eps); } G.push(g); s2 += g[0] * g[0] + g[1] * g[1] + g[2] * g[2]; }
      if (s2 < 1e-12) continue; const lam = stiff * C / s2;
      vs.forEach((v, i) => { if (!free[v]) return; for (let q = 0; q < 3; q++) X[v * 3 + q] -= lam * G[i][q]; }); }
    // the membrane: each edge back to its rest length (both ends free share it; a held end takes none)
    for (let it = 0; it < 2; it++) for (let e = 0; e < Ed.length; e += 3) { const a = Ed[e], b = Ed[e + 1], L0 = Ed[e + 2], wa = free[a], wb = free[b], w = wa + wb; if (!w) continue;
      const dx = X[b * 3] - X[a * 3], dy = X[b * 3 + 1] - X[a * 3 + 1], dz = X[b * 3 + 2] - X[a * 3 + 2], L = Math.hypot(dx, dy, dz); if (!L) continue; const k = 0.5 * (L - L0) / (L * w);
      if (wa) { X[a * 3] += k * dx; X[a * 3 + 1] += k * dy; X[a * 3 + 2] += k * dz; } if (wb) { X[b * 3] -= k * dx; X[b * 3 + 1] -= k * dy; X[b * 3 + 2] -= k * dz; } }
    rounds++; last = census(); }
  const moved = new Uint8Array(n); let nMoved = 0, mx = 0; const D = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) { if (!inR[v]) continue; const dx = X[v * 3] - X0[v * 3], dy = X[v * 3 + 1] - X0[v * 3 + 1], dz = X[v * 3 + 2] - X0[v * 3 + 2], l = Math.hypot(dx, dy, dz); if (l > 1e-7) { moved[v] = 1; nMoved++; mx = Math.max(mx, l); D[v * 3] = dx; D[v * 3 + 1] = dy; D[v * 3 + 2] = dz; } }
  // the bends the shell may make (judged hinges within the limit before): how much of their fold they kept (the alar-facial groove's)
  let kept = 0, keptN = 0; { const Xs = Float64Array.from(X.subarray ? X.subarray(0, n * 3) : X.slice(0, n * 3)); const t1 = H.map(h => h.judged ? theta(h) : 0);
    for (let i = 0; i < n * 3; i++) X[i] = X0[i]; H.forEach((h, i) => { if (!h.judged) return; const t0 = theta(h); if (t0 > 0.35 && t0 <= h.lim) { kept += t1[i] / t0; keptN++; } }); for (let i = 0; i < n * 3; i++) X[i] = Xs[i]; }
  let nIn = 0; for (const v of list) if (inner[v]) nIn++;
  return { moved, D, report: { region: nR, vestibule: nIn, overBentBefore: first.c, worstBefore: +first.worst.toFixed(2), overBentAfter: last.c, worstAfter: +last.worst.toFixed(2), rounds,
    foldsWithinLimitKept: keptN ? +(kept / keptN).toFixed(3) : null, foldsWithinLimitN: keptN, edgesBefore: keys0, edgesAfter: (() => { const k = []; census(k); return k; })(), moved: nMoved, maxMm: +(mx * 1000).toFixed(2) } };
}

export async function alarBase7(P, o = {}) {
  const h = P?.h, body = h?.body, g0 = body?.userData?.geomL0 || body?.geometry; if (!g0?.index) return { skipped: 'no body geometry' };
  const I = await ids(), info = { ...(P.info || {}), name: o.name || P?.info?.name };
  const NP = noseParams({ name: info.name, sex: info.sex, age: info.age, group: info.group });
  const g0X = g0.attributes.position.array, at = (v) => [g0X[v * 3], g0X[v * 3 + 1], g0X[v * 3 + 2]], tip = at(I.prn);
  // the region: the alar lobule and its base, per side a capsule along the ala from the alare to the soft triangle (half way to the tip:
  // the lobule's length on the person's own nose, Oneal and Beil 2010), its radius half the ala's own length (the alar base and the
  // nostril's lateral corner, ~4-6 mm medial and above the alare, lie inside; the cheek beyond the groove does not)
  const segs = [I.al_L, I.al_R].map(v => { const A = at(v); return [A, A.map((x, q) => x + 0.5 * (tip[q] - x))]; });
  const alaLen = Math.hypot(...segs[0][0].map((x, q) => x - tip[q]));
  const rMin = o.rMin ?? NP.env.ala, reach = o.reach ?? 0.5 * alaLen, rep = { version: ALARBASE_VERSION, rMinMm: +rMin.toFixed(2), reachMm: +(reach * 1000).toFixed(1), levels: {} };
  const geoms = [g0, ...Object.values(body.userData?.geoms || {}).filter(g => g && g !== g0)]; if (body.geometry && !geoms.includes(body.geometry)) geoms.push(body.geometry);
  const cb = body.userData?.correctBase;
  for (const g of geoms) {
    const X = g.attributes.position.array, n = g.attributes.position.count, lvl = g.userData?.subdiv?.levels ?? (g === g0 ? 0 : '?');
    const out = relaxAlarBase(X, g.index.array, n, segs, { r: rMin / 1000, reach, rounds: o.rounds });
    if (cb && cb.length === n * 3) { for (let i = 0; i < cb.length; i++) cb[i] += out.D[i]; out.report.correctBase = true; }
    renormal(g, out.moved); g.attributes.position.needsUpdate = true; g.computeBoundingSphere?.(); g.computeBoundingBox?.();
    rep.levels['L' + lvl] = out.report; }
  h.update?.();
  return rep;
}
