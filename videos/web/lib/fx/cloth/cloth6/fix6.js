// CLOTH6: construction strips kept on ONE side of their own garment's cloth. CLOTH5's rulers count each part against itself; counted
// against its garment (labs/clothing2/cloth6/interpart.mjs) K3's turned trouser hem crosses the leg in ~2000 triangles over the twelve, the
// tees' hems ~2000, the sleeve hems ~1000, the coats' hems and plackets ~1500: where the cloth at the edge buckles (a hem resting on a shoe
// or boot, a coat hem, a cuff), the strip built from it (a sweep a few cm inside the edge) passes through the buckled cloth: the dark shards
// at hems on shoes. hemSide6 (a fix5.post pass of bake4.js, after the construction): for every strip of a listed kind, posed, the side of
// its garment's surface most of its vertices lie on is its side; the vertices on the other side (or nearer than `gap`) go to `gap` on it,
// along the surface normal, capped at maxMove; written back to the bind pose through each vertex's own weights. Opt-in (bake6.js FIX6).
import { skinPose, blendInverse, boneMats } from '../collide.js';
export const FIX6_VERSION = 1;
export function hemSide6(h, Sx, parts, { scale, FIN, kinds = /hem|cuff\.edge|cuff\.join|placket/, gap = 0.0012, reach = 0.025, maxMove = 0.015, log = () => {} } = {}) {
  h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), rep = {}, surfOf = new Map(), tmp = [0, 0, 0];
  const surf = id => { if (!surfOf.has(id)) { const r = Sx.recs.get(id); surfOf.set(id, r?.pattern ? FIN.solved(h, r).surf : null); } return surfOf.get(id); };
  for (const q of parts) { if (q.group !== 'construction' || !kinds.test(q.name || '')) continue; const id = /^outer\./.test(q.name) ? 'outer' : q.part, S = id && surf(id); if (!S) continue;
    const n = q.X.length / 3, Xh = new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) Xh[i] = q.X[i] / scale;
    const P = skinPose(Xh, q.SI, q.SW, M, new Float64Array(n * 3), scale), D = new Float64Array(n), N = new Float64Array(n * 3), near = new Uint8Array(n); let sum = 0;
    for (let v = 0; v < n; v++) { const c = S.closest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], reach); if (!c || c.edge) continue; near[v] = 1; D[v] = c.d; N[v * 3] = c.nx; N[v * 3 + 1] = c.ny; N[v * 3 + 2] = c.nz; sum += c.d > 0 ? 1 : -1; }
    if (!sum) continue; const s = sum > 0 ? 1 : -1; let moved = 0, mx = 0;
    for (let v = 0; v < n; v++) { if (!near[v] || s * D[v] >= gap) continue; const k = s * (gap - s * D[v]); if (Math.abs(k) > maxMove) continue;
      P[v * 3] += N[v * 3] * k; P[v * 3 + 1] += N[v * 3 + 1] * k; P[v * 3 + 2] += N[v * 3 + 2] * k;
      blendInverse(q.SI, q.SW, v, M, P[v * 3] / scale, P[v * 3 + 1] / scale, P[v * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) q.X[v * 3 + c] = tmp[c] * scale; moved++; mx = Math.max(mx, Math.abs(k)); }
    const r = rep[q.name.replace(/\.(L|R)$/, '')] ||= { parts: 0, moved: 0, of: 0, maxMm: 0, side: s }; r.parts++; r.moved += moved; r.of += n; r.maxMm = Math.max(r.maxMm, +(mx * 1000).toFixed(1)); }
  log('hemSide6', JSON.stringify(rep)); return rep;
}
