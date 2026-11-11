// TISSUE9-FACE / PROJECT: THE RENDER MESH ONTO THE SOLVED SKIN, FOR ITS TOPOLOGY ONLY (16 Oct 2026, round 8 iteration 1).
// hm08's head (its UVs, its rig, its lids' rings) is moved onto the skin's outer surface the tissue solve made (head.js): a closest-point
// shrink-wrap with a smoothness term, so the vertices keep their order and spacing (correspondence), and the anatomy's own FEATURE LINES
// matched by arc length: hm08's lid-margin rings onto the palpebral fissures' margins (the canthi on their tendons), hm08's stomion line
// onto the oral fissure, hm08's commissures, subnasale and pronasale onto the anatomy's. NO data weight hands any region back to hm08's
// shape and there is no per-region blend: every outer vertex ends ON the solved skin. What has no solved surface yet is CARRIED by the
// smoothness (its displacement the harmonic interpolation of its neighbours'): the auricles (no ear anatomy yet), the mouth's inside
// behind the lips, the eye sockets' lining behind the lid margins; and the neck below the domain's cut fades to hm08's own (the body's
// seam: the body's vertices do not move here). Pure JS; millimetres in the craniometric frame.
//   const R = projectHead(Pmm, tri, nb, Hd, ctx)   Pmm: hm08's head in the frame (mm, Float64Array nb*3); tri: triangles (any; those within
//     the head used); Hd: head.js's result; ctx: { ids (the face's landmark ids), lid: { L: [ids], R }, proxy: { L: { c, r }, R } (the
//     hook's eyes) } -> { U (mm, Float64Array nb*3), report }
export const PROJECT_VERSION = 1;
const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// a polyline resampled at arc-length fractions
function along(pts, t) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + v3.dist(pts[i], pts[i - 1])); const s = t * L[L.length - 1];
  for (let i = 1; i < pts.length; i++) if (s <= L[i]) { const f = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1); return v3.lerp(pts[i - 1], pts[i], f); } return pts[pts.length - 1].slice(); }
// the shortest edge path between two vertices over an allowed set (Dijkstra on the mesh's edges)
function pathOn(adj, P, a, b, ok) { const n = adj.length, d = new Float64Array(n).fill(Infinity), pr = new Int32Array(n).fill(-1), done = new Uint8Array(n); d[a] = 0; const Q = [a];
  while (Q.length) { let bi = 0; for (let i = 1; i < Q.length; i++) if (d[Q[i]] < d[Q[bi]]) bi = i; const u = Q[bi]; Q.splice(bi, 1); if (done[u]) continue; done[u] = 1; if (u === b) break;
    for (const w of adj[u]) { if (!ok(w) && w !== b) continue; const nd = d[u] + Math.hypot(P[u * 3] - P[w * 3], P[u * 3 + 1] - P[w * 3 + 1], P[u * 3 + 2] - P[w * 3 + 2]); if (nd < d[w]) { d[w] = nd; pr[w] = u; Q.push(w); } } }
  const out = []; for (let u = b; u >= 0; u = pr[u]) { out.push(u); if (u === a) break; } return out[out.length - 1] === a ? out.reverse() : null; }

export function projectHead(P, tri, nb, Hd, ctx) {
  const t0 = Date.now(), F = Hd.skin, M = Hd.marks, rep = { version: PROJECT_VERSION };
  // the head's own edges
  const adjS = Array.from({ length: nb }, () => new Set()); for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= nb || b >= nb || c >= nb) continue; adjS[a].add(b).add(c); adjS[b].add(a).add(c); adjS[c].add(a).add(b); }
  const adj = adjS.map(s => Int32Array.from(s)), at = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], I = ctx.ids;
  // ---- the vertices' roles: OUTER (onto the skin), CARRIED (by the smoothness), the neck's fade below the cut
  const role = new Uint8Array(nb);   // 0 outer, 1 carried, 2 unused (no edges)
  const yCut = Hd.report.domain.yCut, fade = new Float64Array(nb);
  const ear = s => { const sa = at(I['sa_' + s]), sba = at(I['sba_' + s]), c = v3.lerp(sa, sba, 0.5), half = Math.max(18, v3.dist(sa, sba) / 2 + 6); return p => Math.abs(p[0]) > Math.abs(c[0]) - 9 && Math.abs(p[1] - c[1]) < half && Math.abs(p[2] - c[2]) < 0.65 * half + 6; };
  const earL = ear('L'), earR = ear('R'), sto0 = at(I.sto), chL = at(I.ch_L), mouthIn = p => Math.abs(p[0]) < Math.abs(chL[0]) + 3 && Math.abs(p[1] - sto0[1]) < 13 && p[2] < sto0[2] - 6;
  const eyeIn = s => { const pr = ctx.proxy?.[s], ring = (ctx.lid?.[s] || []).map(at), zr = ring.reduce((a, p) => a + p[2], 0) / Math.max(1, ring.length); return p => pr && v3.dist(p, pr.c) < pr.r + 3.5 && p[2] < zr - 0.8; };
  const eyeL = eyeIn('L'), eyeR = eyeIn('R');
  let nOuter = 0, nCar = 0; for (let v = 0; v < nb; v++) { if (!adj[v].length) { role[v] = 2; continue; } const p = at(v);
    fade[v] = sstep(yCut - 4, yCut + 22, p[1]);   // 1 above, 0 below the cut's band
    if (earL(p) || earR(p) || mouthIn(p) || eyeL(p) || eyeR(p)) { role[v] = 1; nCar++; } else nOuter++; }
  // ---- the feature lines (vertex chains) and their targets on the anatomy
  const feat = new Map();   // v -> target (mm)
  const ringSplit = (ring, en, ex) => { // the ring as two chains from en to ex (upper first)
    const i0 = ring.indexOf(en), i1 = ring.indexOf(ex); if (i0 < 0 || i1 < 0) return null; const n = ring.length, A = [], B = [];
    for (let i = i0; ; i = (i + 1) % n) { A.push(ring[i]); if (i === i1) break; } for (let i = i0; ; i = (i - 1 + n) % n) { B.push(ring[i]); if (i === i1) break; }
    const yA = A.reduce((s, v) => s + P[v * 3 + 1], 0) / A.length, yB = B.reduce((s, v) => s + P[v * 3 + 1], 0) / B.length; return yA > yB ? [A, B] : [B, A]; };
  const chainTo = (chain, pts, lift = 0) => { const L = [0]; for (let i = 1; i < chain.length; i++) L.push(L[i - 1] + v3.dist(at(chain[i]), at(chain[i - 1]))); const T = L[L.length - 1] || 1; chain.forEach((v, i) => { const q = along(pts, L[i] / T); feat.set(v, [q[0], q[1], q[2] + lift]); }); };
  for (const s of ['L', 'R']) { const ring = (ctx.lid?.[s] || []).filter(v => v < nb), E = M.eyes[s], sp = ringSplit(ring, I['en_' + s], I['ex_' + s]); if (!sp) { rep['lid' + s] = 'skipped'; continue; }
    chainTo(sp[0], E.upper, 0.6); chainTo(sp[1], E.lower, 0.6); rep['lid' + s] = { upper: sp[0].length, lower: sp[1].length }; }
  // hm08's stomion line: the shortest path from one commissure through the stomion to the other, along the lips' meeting
  { const okM = w => Math.abs(P[w * 3 + 1] - sto0[1]) < 4 && Math.abs(P[w * 3]) < Math.abs(chL[0]) + 2 && P[w * 3 + 2] > sto0[2] - 14;
    const a = pathOn(adj, P, I.ch_L, I.sto, okM), b = pathOn(adj, P, I.sto, I.ch_R, okM), sto = M.stomion;
    if (a && b) { const line = a.concat(b.slice(1)); chainTo(line, [M.mouth.ch_L, ...sto.filter(p => Math.abs(p[0]) < Math.abs(M.mouth.ch_L[0])).sort((p, q) => q[0] - p[0]), M.mouth.ch_R]); rep.stomion = line.length; }
    else rep.stomion = 'no path'; }
  for (const [id, q] of [['prn', M.nose.prn], ['sn', M.nose.sn]]) if (I[id] != null) feat.set(I[id], q.slice());
  rep.features = feat.size;
  // the MARGIN BANDS: hm08's lid margins and the lips' meeting have a thickness (an inner and an outer row a mm or two apart) the solved
  // surface carries as one edge: the vertices within 2.5 mm of a lid ring (1.2 mm of the stomion line) take no data term (their crossing
  // would fold over the ring's), only the smoothness between the feature line and the skin beyond
  const band = new Uint8Array(nb); { const lines = []; for (const s of ['L', 'R']) lines.push([(ctx.lid?.[s] || []).filter(v => v < nb && feat.has(v)), 2.5]); lines.push([[...feat.keys()].filter(v => Math.abs(P[v * 3 + 1] - sto0[1]) < 6 && Math.abs(P[v * 3]) < Math.abs(chL[0]) + 1), 1.2]);
    for (const [L0, d] of lines) { const pts = L0.map(at); for (let v = 0; v < nb; v++) { if (role[v] !== 0 || feat.has(v)) continue; const p = at(v); for (const q of pts) if (v3.dist(p, q) < d) { band[v] = 1; break; } } } }
  rep.marginBand = band.reduce((a, b) => a + b, 0);
  // the LIDS stiffer (x4 within 9 mm of a lid ring): hm08's lid carries a fold the grown lid (orbicularis on the globe) does not have yet;
  // a soft sheet there folded over itself, a stiff one lies on the grown lid as a whole (it1: the lid crease is iteration 2's anatomy)
  const stiff = new Float64Array(nb).fill(1); for (const s of ['L', 'R']) { const pts = (ctx.lid?.[s] || []).filter(v => v < nb).map(at); for (let v = 0; v < nb; v++) { const p = at(v); for (const q of pts) if (v3.dist(p, q) < 9) { stiff[v] = ctx.lidStiff ?? 12; break; } } }
  // ---- the solve: closest points on the skin for the outer vertices, the smoothness (the graph Laplacian), the features held strongly;
  // re-projected and re-solved (an ICP), then every outer vertex put ON the surface
  const U = new Float64Array(nb * 3), D = new Float64Array(nb * 3), g = [0, 0, 0];
  const closest = (p, out) => { let q = p.slice(); for (let i = 0; i < 4; i++) { const d = F.value(q[0], q[1], q[2]); F.grad(q[0], q[1], q[2], g, 0.5); q = [q[0] - d * g[0], q[1] - d * g[1], q[2] - d * g[2]]; } out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; return F.value(q[0], q[1], q[2]); };
  // the DATA TERM along each vertex's own normal (the current mesh's, area-weighted, smoothed over its ring): the skin's crossing nearest the
  // vertex along that line (within 18 mm); a vertex moves across the surface, not along it, so the mesh keeps its layout (closest points slid
  // vertices together where the two surfaces' curvatures differ and turned triangles over: it1's first projection, 5-7 % round the eyes,
  // the nose's tip and the commissures). No crossing: the closest point.
  const Nv = new Float64Array(nb * 3), cur = new Float64Array(nb * 3);
  const normals = () => { Nv.fill(0); for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= nb || b >= nb || c >= nb) continue;
      const ux = cur[b * 3] - cur[a * 3], uy = cur[b * 3 + 1] - cur[a * 3 + 1], uz = cur[b * 3 + 2] - cur[a * 3 + 2], wx = cur[c * 3] - cur[a * 3], wy = cur[c * 3 + 1] - cur[a * 3 + 1], wz = cur[c * 3 + 2] - cur[a * 3 + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; for (const v of [a, b, c]) { Nv[v * 3] += nx; Nv[v * 3 + 1] += ny; Nv[v * 3 + 2] += nz; } }
    const N2 = new Float64Array(Nv); for (let v = 0; v < nb; v++) for (const w of adj[v]) { N2[v * 3] += 0.5 * Nv[w * 3]; N2[v * 3 + 1] += 0.5 * Nv[w * 3 + 1]; N2[v * 3 + 2] += 0.5 * Nv[w * 3 + 2]; }
    for (let v = 0; v < nb; v++) { const l = Math.hypot(N2[v * 3], N2[v * 3 + 1], N2[v * 3 + 2]) || 1; Nv[v * 3] = N2[v * 3] / l; Nv[v * 3 + 1] = N2[v * 3 + 1] / l; Nv[v * 3 + 2] = N2[v * 3 + 2] / l; } };
  // the crossing along a direction n: the tissue's EXIT point (inside -> outside along +n) nearest the vertex: from inside march out, from
  // outside march back in; the exit's own normal must face n (else the closest point). Every vertex so lands on the outward-facing sheet
  // (never an oral fissure's wall, a nostril's far side or the globe's back), and neighbours on one sheet
  const gF = [0, 0, 0];
  const alongN = (p, n, out) => { const f0 = F.value(p[0], p[1], p[2]), sg = f0 < 0 ? 1 : -1; let prev = f0, hit = null;
    for (let t = 0.2; t <= 18; t += 0.2) { const q = [p[0] + sg * t * n[0], p[1] + sg * t * n[1], p[2] + sg * t * n[2]], f = F.value(q[0], q[1], q[2]);
      if ((f < 0) !== (prev < 0)) { const tt = t - 0.2 * Math.abs(f) / (Math.abs(f) + Math.abs(prev) || 1); hit = [p[0] + sg * tt * n[0], p[1] + sg * tt * n[1], p[2] + sg * tt * n[2]]; break; } prev = f; }
    if (hit) { F.grad(hit[0], hit[1], hit[2], gF, 0.5); if (gF[0] * n[0] + gF[1] * n[1] + gF[2] * n[2] > 0.2) { out[0] = hit[0]; out[1] = hit[1]; out[2] = hit[2]; return true; } }
    closest(p, out); return false; };
  // the directions: the HOOK's own normals, smoothed over three rings (fixed through the solve: they do not turn with a fold)
  for (let i = 0; i < nb * 3; i++) cur[i] = P[i]; normals(); const N0 = new Float64Array(Nv);
  for (let r = 0; r < 3; r++) { const N2 = new Float64Array(N0); for (let v = 0; v < nb; v++) for (const w of adj[v]) { N2[v * 3] += N0[w * 3]; N2[v * 3 + 1] += N0[w * 3 + 1]; N2[v * 3 + 2] += N0[w * 3 + 2]; }
    for (let v = 0; v < nb; v++) { const l = Math.hypot(N2[v * 3], N2[v * 3 + 1], N2[v * 3 + 2]) || 1; N0[v * 3] = N2[v * 3] / l; N0[v * 3 + 1] = N2[v * 3 + 1] / l; N0[v * 3 + 2] = N2[v * 3 + 2] / l; } }
  const dirOf = v => [N0[v * 3], N0[v * 3 + 1], N0[v * 3 + 2]];
  // the stiffness ANNEALED (a non-rigid ICP: the mesh first follows the skin's broad form as a whole, so its normals turn with it, then
  // ever finer): alpha from 6 to 0.35 over the rounds
  const ALPHA = ctx.alphas ?? [6, 3, 1.5, 0.8, 0.5, 0.35, 0.25], wF = 40, q = [0, 0, 0]; let nAlong = 0, alpha = ALPHA[0];
  for (let outer = 0; outer < ALPHA.length; outer++) { alpha = ALPHA[outer];
    for (let i = 0; i < nb * 3; i++) cur[i] = P[i] + U[i]; normals(); nAlong = 0;
    for (let v = 0; v < nb; v++) { if (role[v] !== 0) continue; const p = [cur[v * 3], cur[v * 3 + 1], cur[v * 3 + 2]]; if (alongN(p, dirOf(v), q)) nAlong++; for (let a = 0; a < 3; a++) D[v * 3 + a] = q[a] - P[v * 3 + a]; }
    for (let it = 0; it < (ctx.iters ?? 150); it++) for (let v = 0; v < nb; v++) { if (role[v] === 2) continue; const nbv = adj[v]; let wsum = 0, s0 = 0, s1 = 0, s2 = 0;
      for (const w of nbv) { s0 += U[w * 3]; s1 += U[w * 3 + 1]; s2 += U[w * 3 + 2]; } const al = alpha * stiff[v]; wsum = al * nbv.length; s0 *= al; s1 *= al; s2 *= al;
      const f = fade[v]; if (role[v] === 0 && f > 0 && !band[v]) { const wd = f; s0 += wd * D[v * 3]; s1 += wd * D[v * 3 + 1]; s2 += wd * D[v * 3 + 2]; wsum += wd; }
      if (f < 1) { wsum += (1 - f) * 4; }   // below the cut: held at hm08's (U -> 0)
      const T = feat.get(v); if (T && f > 0.5) { s0 += wF * (T[0] - P[v * 3]); s1 += wF * (T[1] - P[v * 3 + 1]); s2 += wF * (T[2] - P[v * 3 + 2]); wsum += wF; }
      U[v * 3] = s0 / wsum; U[v * 3 + 1] = s1 / wsum; U[v * 3 + 2] = s2 / wsum; }
  }
  // the final step: each outer vertex onto the surface ALONG ITS NORMAL (the features kept); then any triangle turned over is untangled (its
  // vertices relaxed toward their ring's mean, a few passes, and put back on the surface along the normal)
  for (let i = 0; i < nb * 3; i++) cur[i] = P[i] + U[i]; normals();
  let maxR = 0, sumR = 0, nR = 0; for (let v = 0; v < nb; v++) { if (role[v] !== 0 || feat.has(v) || band[v]) continue; const f = fade[v]; if (f <= 0) continue; const p = [cur[v * 3], cur[v * 3 + 1], cur[v * 3 + 2]], d = F.value(p[0], p[1], p[2]);
    const r = Math.abs(d); maxR = Math.max(maxR, r); sumR += r; nR++; if (r > (ctx.snapMax ?? 1.0) || stiff[v] > 1) continue; alongN(p, dirOf(v), q); for (let a = 0; a < 3; a++) U[v * 3 + a] += f * (q[a] - p[a]); }
  const flipped = () => { const bad = new Uint8Array(nb); let c = 0; for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], cc = tri[t + 2]; if (a >= nb || b >= nb || cc >= nb) continue; if (role[a] || role[b] || role[cc] || fade[a] < 1) continue;
      const nrm = (A, o) => { const ux = A[b * 3] - A[a * 3] + (o ? U[b * 3] - U[a * 3] : 0), uy = A[b * 3 + 1] - A[a * 3 + 1] + (o ? U[b * 3 + 1] - U[a * 3 + 1] : 0), uz = A[b * 3 + 2] - A[a * 3 + 2] + (o ? U[b * 3 + 2] - U[a * 3 + 2] : 0), wx = A[cc * 3] - A[a * 3] + (o ? U[cc * 3] - U[a * 3] : 0), wy = A[cc * 3 + 1] - A[a * 3 + 1] + (o ? U[cc * 3 + 1] - U[a * 3 + 1] : 0), wz = A[cc * 3 + 2] - A[a * 3 + 2] + (o ? U[cc * 3 + 2] - U[a * 3 + 2] : 0); return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; };
      const n0 = nrm(P, 0), n1 = nrm(P, 1); if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0) { bad[a] = bad[b] = bad[cc] = 1; c++; } } return { bad, c }; };
  let fl = flipped(); rep.turnedBefore = fl.c;
  for (let pass = 0; pass < (ctx.untangle ?? 0) && fl.c > 0; pass++) { const grow = new Uint8Array(fl.bad); for (let v = 0; v < nb; v++) if (fl.bad[v]) for (const w of adj[v]) grow[w] = 1;
    for (let it = 0; it < 10; it++) for (let v = 0; v < nb; v++) { if (!grow[v] || role[v] !== 0 || feat.has(v)) continue; let s0 = 0, s1 = 0, s2 = 0; for (const w of adj[v]) { s0 += P[w * 3] + U[w * 3]; s1 += P[w * 3 + 1] + U[w * 3 + 1]; s2 += P[w * 3 + 2] + U[w * 3 + 2]; } const k = adj[v].length;
      U[v * 3] = 0.5 * U[v * 3] + 0.5 * (s0 / k - P[v * 3]); U[v * 3 + 1] = 0.5 * U[v * 3 + 1] + 0.5 * (s1 / k - P[v * 3 + 1]); U[v * 3 + 2] = 0.5 * U[v * 3 + 2] + 0.5 * (s2 / k - P[v * 3 + 2]); }
    for (let i = 0; i < nb * 3; i++) cur[i] = P[i] + U[i]; normals();
    for (let v = 0; v < nb; v++) { if (!grow[v] || role[v] !== 0 || feat.has(v)) continue; const p = [cur[v * 3], cur[v * 3 + 1], cur[v * 3 + 2]]; alongN(p, dirOf(v), q); for (let a = 0; a < 3; a++) U[v * 3 + a] += 0.7 * (q[a] - p[a]); }
    fl = flipped(); }
  rep.turnedAfter = fl.c; rep.alongNormal = nAlong;
  let mx = 0; for (let v = 0; v < nb; v++) mx = Math.max(mx, Math.hypot(U[v * 3], U[v * 3 + 1], U[v * 3 + 2]));
  Object.assign(rep, { outer: nOuter, carried: nCar, snapMeanMm: +(sumR / Math.max(1, nR)).toFixed(2), snapMaxMm: +maxR.toFixed(2), maxMoveMm: +mx.toFixed(1), ms: Date.now() - t0 });
  return { U, role, report: rep };
}
// the eyes' seat: each globe moved whole from the hook's eye to the globe the orbit seats (skull.js B.globe), as face9 did (membrane.js
// globeSeat: the centre in x and y, the corneal apex in z when the hook's apex is known)
export function globeSeat(B, apex = null) { const out = {};
  for (const s of ['L', 'R']) { const gb = B.globe[s].c, gp = B.globeProxy[s].c, ap = apex?.[s]; out[s] = [gb[0] - gp[0], gb[1] - gp[1], ap != null ? B.lm.cornea - ap : gb[2] - gp[2]]; }
  return out; }
