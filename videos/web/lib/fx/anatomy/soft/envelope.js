// ANATOMY / SOFT / ENVELOPE: the soft-tissue solve's loaded outer skin as DATA (ANAT8-BODY, lane iteration 10 = c4 iteration 1, 8 Oct 2026).
// The solver (soft/index.js, soft/breast.js) runs OFFLINE in node per person (since 15 Oct the person build itself bakes it on a missing key: lib/fx/person/
// soft7.js, the integrator's, keyed by the body, the record and the versions; labs/human8/anat8b/soft_bake.mjs deleted); this file is the format it writes, the
// loader the page and the export read, and the queries a membrane fit needs (BODY7's lib/fx/body/membrane7.js is THE fit: fitEnvs below hands it this
// bake). Nothing here solves anything: the page never runs the solver.
//   assets/anatomy/soft/<name>.json = { kind: 'anat8b-soft-envelope', version, name, record, solver: {...}, sides: { L, R } }
//   side = { O, E1, E2, D (the region's frame, bind metres), q (quantum, m), pos (base64 Int16 xyz - O, / q), tri (base64 Uint16 | Uint32), w (base64
//            Uint8: the BLEND WEIGHT x 255, 1 where the solve is the breast's own skin, falling to 0 toward the region's cuts and outside the anchoring
//            ring, so the fit hands back to the body's own skin there), nipple (the solve's TRACKED nipple, a material point, loaded), nippleN (the skin's
//            normal there), nipple0 (the unloaded reference's), fold (the tracked inframammary line, loaded), report (the solve's checks, described) }
// Frame: the person's bind space (metres; x lateral, L = +x; y up; z forward), the same space as the hero's body geometry (makePerson v7, measured:
// lane iteration 10, hero bind vs the record's built body: 1.6 mm mean).
export const ENVELOPE_VERSION = 1;
const ASSETS = new URL('../../../../assets/', import.meta.url).href;

// ---------------------------------------------------------------- encoding (node: the bake)
const b64 = typeof Buffer !== 'undefined' ? (u8 => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64'))
  : (u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); });
const unb64 = (s, T) => { let u8; if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); u8 = new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  else { const bin = atob(s); u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); } return new T(u8.buffer, 0, u8.byteLength / T.BYTES_PER_ELEMENT); };
const r5 = v => +v.toFixed(5);

// a side from the solve's loaded surface: only the 'skin'-labelled triangles whose blend weight is above 0 (the rest is never fitted), clustered on the
// solver's own surface grid (the surface nets were sampled at R.surfH from R.box's corner in the region frame: clusters of 2 x 2 x 2 of its cells, taken on
// the REFERENCE positions, keep the clustered mesh a surface net of the doubled grid, without the holes an unaligned clustering tears) so the asset stays
// small; w per vertex from the MATERIAL (reference) position: the anchoring ring's normalised radius rho and the distance to the region's cuts
export function encodeSide(Z, { k = 2, q = 1e-5 } = {}) {
  const sf = Z.L.surface, m = Z.R.meta, iSkin = sf.labels.indexOf('skin'), P = sf.pos, P0 = sf.pos0, T = sf.tri, lab = sf.label, nf = P.length / 3;
  const { O, E1, E2, D } = m, ab = m.ab, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], RB = Z.R.box, hs = Z.R.surfH || Z.R.h / 2, cell = k * hs;
  const ss = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }, RG = { in: 0.95, out: 1.15 };
  // the blend weight at a reference position: 1 inside the ring's outer edge, 0 by rho 1.6; and 0 within 1 cm of a cut, 1 from 3 cm (the cut walls are held);
  // (soft/breast.js v12) and 1 over the person's OLD breast, 0 by 2 cm outside it (m.oldW): the as-built breast is replaced whole, never handed back to
  const wAt = p0 => { const [a, b] = ab(p0), rho = m.rhoAt(a, b), cut = Math.min(a - m.a0, m.a1 - a, b - m.b0, m.b1 - b); return Math.max(1 - ss((rho - RG.out) / 0.45), m.oldW ? m.oldW(a, b) : 0) * ss((cut - 0.01) / 0.02); };
  const wf = new Float32Array(nf); for (let v = 0; v < nf; v++) wf[v] = wAt([P0[v * 3], P0[v * 3 + 1], P0[v * 3 + 2]]);
  const skinT = t => lab[T[t]] === iSkin && lab[T[t + 1]] === iSkin && lab[T[t + 2]] === iSkin;   // the surface's labels are per VERTEX (soft/index.js)
  const keepT = t => skinT(t) && (wf[T[t]] > 0 || wf[T[t + 1]] > 0 || wf[T[t + 2]] > 0);
  const used = new Uint8Array(nf); for (let t = 0; t < T.length; t += 3) if (keepT(t)) { used[T[t]] = used[T[t + 1]] = used[T[t + 2]] = 1; }
  // the solver's grid frame (soft/index.js: R.frame O, ax; the surface nets from R.box's corner at surfH)
  const fO = Z.R.frame.O, [e1, e2, e3] = Z.R.frame.ax, key = new Map(), cl = [], vmap = new Int32Array(nf).fill(-1);
  for (let v = 0; v < nf; v++) { if (!used[v]) continue; const d = [P0[v * 3] - fO[0], P0[v * 3 + 1] - fO[1], P0[v * 3 + 2] - fO[2]];
    const kk = Math.floor((dot(d, e1) - RB[0]) / cell) + ',' + Math.floor((dot(d, e2) - RB[1]) / cell) + ',' + Math.floor((dot(d, e3) - RB[2]) / cell); let c = key.get(kk);
    if (c == null) { c = cl.length; key.set(kk, c); cl.push({ s: [0, 0, 0], w: 0, n: 0 }); } const C = cl[c]; for (let j = 0; j < 3; j++) C.s[j] += P[v * 3 + j]; C.w += wf[v]; C.n++; vmap[v] = c; }
  const tri = [], seen = new Set(); for (let t = 0; t < T.length; t += 3) { if (!keepT(t)) continue; const a = vmap[T[t]], b = vmap[T[t + 1]], c = vmap[T[t + 2]]; if (a === b || b === c || a === c) continue;
    const kk = [a, b, c].sort((x, y) => x - y).join(','); if (seen.has(kk)) continue; seen.add(kk); tri.push(a, b, c); }
  const n = cl.length, pos = new Int16Array(n * 3), w = new Uint8Array(n);
  let maxQ = 0;
  for (let c = 0; c < n; c++) { const C = cl[c];
    for (let j = 0; j < 3; j++) { const v = Math.round((C.s[j] / C.n - O[j]) / q); maxQ = Math.max(maxQ, Math.abs(v)); pos[c * 3 + j] = Math.max(-32767, Math.min(32767, v)); }
    w[c] = Math.round(255 * C.w / C.n); }
  if (maxQ > 32767) throw new Error('envelope: a vertex beyond the Int16 range (' + (maxQ * q).toFixed(3) + ' m from O)');
  const big = n > 65535, triA = big ? Uint32Array.from(tri) : Uint16Array.from(tri);
  // the nipple's skin normal on the loaded surface: the area-weighted normal of the skin triangles within 1 cm of it
  const Nl = Z.L.track.nipple, nn = [0, 0, 0]; for (let t = 0; t < T.length; t += 3) { if (!skinT(t)) continue; const i = T[t] * 3, j = T[t + 1] * 3, k = T[t + 2] * 3;
    const cx = (P[i] + P[j] + P[k]) / 3 - Nl[0], cy = (P[i + 1] + P[j + 1] + P[k + 1]) / 3 - Nl[1], cz = (P[i + 2] + P[j + 2] + P[k + 2]) / 3 - Nl[2]; if (cx * cx + cy * cy + cz * cz > 1e-4) continue;
    const ux = P[j] - P[i], uy = P[j + 1] - P[i + 1], uz = P[j + 2] - P[i + 2], vx = P[k] - P[i], vy = P[k + 1] - P[i + 1], vz = P[k + 2] - P[i + 2];
    nn[0] += uy * vz - uz * vy; nn[1] += uz * vx - ux * vz; nn[2] += ux * vy - uy * vx; }
  let ln = Math.hypot(...nn) || 1; if (dot(nn, D) < 0) ln = -ln;
  const folds = Object.entries(Z.L.track).filter(([k]) => k.startsWith('fold')).map(([, p]) => p.map(r5));
  return { O: O.map(r5), E1: E1.map(r5), E2: E2.map(r5), D: D.map(r5), q, n, nt: tri.length / 3, big, pos: b64(new Uint8Array(pos.buffer)), tri: b64(new Uint8Array(triA.buffer)), w: b64(w),
    nipple: Nl.map(r5), nippleN: nn.map(v => r5(v / ln)), nipple0: Z.S.trk[0].p0.map(r5), fold: folds };
}

// ---------------------------------------------------------------- loading (page, node, export, the skin bake)
const _cache = new Map();
export async function loadEnvelope(name, { url = null } = {}) {
  const u = url || ASSETS + 'anatomy/soft/' + name + '.json';
  if (!_cache.has(u)) _cache.set(u, fetch(u).then(r => (r.ok === false ? null : r.json())).then(J => (J ? decodeEnvelope(J) : null)).catch(() => null));
  return _cache.get(u);
}
export function decodeEnvelope(J) {
  if (!J || J.kind !== 'anat8b-soft-envelope') return null;
  const sides = {};
  for (const [S_, s] of Object.entries(J.sides || {})) {
    const p = unb64(s.pos, Int16Array), P = new Float64Array(s.n * 3); for (let i = 0; i < s.n; i++) for (let j = 0; j < 3; j++) P[i * 3 + j] = s.O[j] + p[i * 3 + j] * s.q;
    const T = s.big ? unb64(s.tri, Uint32Array) : unb64(s.tri, Uint16Array), W8 = unb64(s.w, Uint8Array), W = new Float32Array(s.n); for (let i = 0; i < s.n; i++) W[i] = W8[i] / 255;
    // the winding's outward sign, once for the surface (the solver's surface is consistently wound): the area-weighted mean normal against the axis D
    let sg = 0; for (let t = 0; t < T.length; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      sg += (uy * vz - uz * vy) * s.D[0] + (uz * vx - ux * vz) * s.D[1] + (ux * vy - uy * vx) * s.D[2]; }
    sides[S_] = { side: S_, O: s.O, E1: s.E1, E2: s.E2, D: s.D, pos: P, tri: Uint32Array.from(T), w: W, nipple: s.nipple, nippleN: s.nippleN, nipple0: s.nipple0, fold: s.fold || [], out: sg >= 0 ? 1 : -1, grid: null };
  }
  return { name: J.name, version: J.version, record: J.record, solver: J.solver, key: J.key || null, report: J.report || null, sides };
}
// the bake's KEY (15 Oct, c5 iteration 1: the bake is what the person's build reads, so it must say what it was solved from): the person's built body
// (the prior body's first nb vertices, hm08's, quantised to 0.05 mm, FNV-1a 32) and the solver's code (soft/hook.js softCode: the skeleton's, the
// muscles', the solver's, the breast region's and this format's versions). A bake is CURRENT only when both match the person being built; a stale
// bake is never fitted (the hook solves again in node, or reports it in a page).
export function bodyKey(pos, nb) {
  let h = 0x811c9dc5 >>> 0; const n = Math.min(nb * 3, pos.length);
  for (let i = 0; i < n; i++) { let v = Math.round(pos[i] / 5e-5) | 0; for (let k = 0; k < 4; k++) { h ^= v & 255; h = Math.imul(h, 0x01000193) >>> 0; v >>= 8; } }
  return h.toString(16).padStart(8, '0') + ':' + nb;
}

// ---------------------------------------------------------------- queries: the closest point on a side's surface (a uniform grid over its triangles)
function gridOf(E, cell = 0.01) {
  if (E.grid) return E.grid;
  const P = E.pos, T = E.tri, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[i + j]); hi[j] = Math.max(hi[j], P[i + j]); }
  const dim = [0, 1, 2].map(j => Math.max(1, Math.ceil((hi[j] - lo[j]) / cell) + 1)), cells = new Map();
  for (let t = 0; t < T.length; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3, mn = [0, 1, 2].map(j => Math.min(P[a + j], P[b + j], P[c + j])), mx = [0, 1, 2].map(j => Math.max(P[a + j], P[b + j], P[c + j]));
    const i0 = mn.map((v, j) => Math.floor((v - lo[j]) / cell)), i1 = mx.map((v, j) => Math.floor((v - lo[j]) / cell));
    for (let x = i0[0]; x <= i1[0]; x++) for (let y = i0[1]; y <= i1[1]; y++) for (let z = i0[2]; z <= i1[2]; z++) { const k = (x * dim[1] + y) * dim[2] + z; let L = cells.get(k); if (!L) cells.set(k, L = []); L.push(t / 3); } }
  return (E.grid = { lo, hi, cell, dim, cells });
}
// closest point on triangle (Ericson), returns [x, y, z, u, v, w] (barycentrics)
function cpTri(px, py, pz, P, a, b, c, out) {
  const ax = P[a], ay = P[a + 1], az = P[a + 2], abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const set = (u, v, w) => { out[0] = u * ax + v * P[b] + w * P[c]; out[1] = u * ay + v * P[b + 1] + w * P[c + 1]; out[2] = u * az + v * P[b + 2] + w * P[c + 2]; out[3] = u; out[4] = v; out[5] = w; return out; };
  if (d1 <= 0 && d2 <= 0) return set(1, 0, 0);
  const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(0, 1, 0);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(1 - v, v, 0); }
  const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(0, 0, 1);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(0, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return set(1 - v - w, v, w);
}
// -> { p: [x,y,z], d (m), t (triangle), bc: [u,v,w], w (the blend weight there), n (the triangle's unit normal) } or null beyond maxD
export function closestOn(E, x, y, z, maxD = 0.05) {
  const G = gridOf(E), P = E.pos, T = E.tri, c = G.cell, ix = Math.floor((x - G.lo[0]) / c), iy = Math.floor((y - G.lo[1]) / c), iz = Math.floor((z - G.lo[2]) / c), R = Math.ceil(maxD / c);
  const tmp = new Float64Array(6); let best = null, bd = maxD * maxD;
  for (let r = 0; r <= R; r++) {
    for (let X = ix - r; X <= ix + r; X++) for (let Y = iy - r; Y <= iy + r; Y++) for (let Zc = iz - r; Zc <= iz + r; Zc++) {
      if (Math.max(Math.abs(X - ix), Math.abs(Y - iy), Math.abs(Zc - iz)) !== r) continue;
      if (X < 0 || Y < 0 || Zc < 0 || X >= G.dim[0] || Y >= G.dim[1] || Zc >= G.dim[2]) continue;
      const L = G.cells.get((X * G.dim[1] + Y) * G.dim[2] + Zc); if (!L) continue;
      for (const t of L) { cpTri(x, y, z, P, T[t * 3] * 3, T[t * 3 + 1] * 3, T[t * 3 + 2] * 3, tmp); const d2 = (tmp[0] - x) ** 2 + (tmp[1] - y) ** 2 + (tmp[2] - z) ** 2;
        if (d2 < bd) { bd = d2; best = { p: [tmp[0], tmp[1], tmp[2]], t, bc: [tmp[3], tmp[4], tmp[5]] }; } }
    }
    if (best && Math.sqrt(bd) <= r * c) break;   // nothing in a farther shell can be closer
  }
  if (!best) return null;
  const a = T[best.t * 3], b = T[best.t * 3 + 1], cc = T[best.t * 3 + 2];
  best.d = Math.sqrt(bd); best.w = E.w[a] * best.bc[0] + E.w[b] * best.bc[1] + E.w[cc] * best.bc[2];
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[cc * 3] - P[a * 3], vy = P[cc * 3 + 1] - P[a * 3 + 1], vz = P[cc * 3 + 2] - P[a * 3 + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (E.out < 0) { nx = -nx; ny = -ny; nz = -nz; }   // outward: the surface's winding sign (decodeEnvelope)
  best.n = [nx, ny, nz]; return best;
}

// ---------------------------------------------------------------- the seam with BODY7's membrane fit (lib/fx/body/membrane7.js fitMembrane7(h, envs, opts))
// The baked envelope in the form fitMembrane7 takes: [{ name, side, pos (the hero's bind units), tri, label (per vertex), labels, weightAt(q) -> 0..1,
// nipple, report }], so the fit can read the BAKE instead of solving at hook time (breastEnvelopes7 solves 2-5 min a person in the export and again in the
// skin bake's page). weightAt is the bake's own blend weight at the closest envelope point (1 on the breast and its anchoring ring, 0 toward the cuts).
export function fitEnvs(E, { scale = 1 } = {}) {
  return Object.values(E?.sides || {}).map(s => ({ name: 'breast' + s.side, side: s.side, pos: Float64Array.from(s.pos, x => x / scale), tri: s.tri, label: new Int16Array(s.pos.length / 3), labels: ['skin'],
    weightAt: q => { const c = closestOn(s, q[0] * scale, q[1] * scale, q[2] * scale, 0.02); return c ? c.w : 0; }, nipple: s.nipple.map(x => x / scale),
    report: { baked: true, envelope: E.name, solver: E.solver, ...(E.report?.[s.side] || {}) } }));
}
