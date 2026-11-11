// CLOTH8 (round 7): the UNDERWEAR of a bake finished (the full-size Cycles read of the v5 underwear, review/studio_human_c8/gpu_cycles: the
// bra's strap ends sat on the cups as loose tabs; the briefs clung to the crotch, the form printing through; crumpled dents on the cups).
// On the bake's own foundation parts (group 'found', bind metres; K3's fit, wardrobe4/bake4.js), so nothing else of the person moves:
//   strapSew  a strap's front rows that lie ON the cup (within 5 mm of the cup's shell, not at its edge) are taken off down to the
//             cup's top edge: the strap starts there, its first row pressed flat into the edge, under the binding (sewn in)
//   bridge    the briefs' shell over the fork and the lower front lifted as a membrane over the hollows (a height along the shell's
//             normal, never lowered, at most `bridge` m, in the region round the crotch): stretched jersey bridges the cleft
//   cupLift   the bra's cups within 4.5 cm of each apex smoothed into a dome and lifted (at most `cupLift` m) over what it smoothed
//             away (a molded cup is a smooth dome: the nipples' detail printed through it as crumpled bumps)
// The bindings and straps follow the shells they are sewn to (carry8). The foundations' live fit has the same options (foundations.js
// FOUND8), for people fitted on the page.   finishFound8(parts, { f8 }) -> report (parts edited in place)
import { SurfaceMesh, vertexNormals } from '../collide.js';
import { bind8, place8 } from './carry8.js';
export const FOUND8_VERSION = 1;
export const F8_DEFAULT = { strapSew: true, bridge: 0.006, cupLift: 0.004 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function lift(X, T, wOf, maxLift) {
  const n = X.length / 3, N = vertexNormals(X, T), nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { nb[T[t + k]].add(T[t + (k + 1) % 3]); nb[T[t + k]].add(T[t + (k + 2) % 3]); }
  const w = new Float64Array(n); let k = 0; for (let v = 0; v < n; v++) { w[v] = wOf(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); if (w[v] > 0) k++; }
  const X0 = Float64Array.from(X), h = new Float64Array(n);
  for (let it = 0; it < 60; it++) { for (let v = 0; v < n; v++) { if (!w[v] || !nb[v].size) continue; let sx = 0, sy = 0, sz = 0; for (const u of nb[v]) { sx += X[u * 3]; sy += X[u * 3 + 1]; sz += X[u * 3 + 2]; } const c = nb[v].size;
      const t = (sx / c - X0[v * 3]) * N[v * 3] + (sy / c - X0[v * 3 + 1]) * N[v * 3 + 1] + (sz / c - X0[v * 3 + 2]) * N[v * 3 + 2]; h[v] = Math.min(maxLift * w[v], Math.max(h[v], t)); }
    for (let v = 0; v < n; v++) if (w[v]) for (let c = 0; c < 3; c++) X[v * 3 + c] = X0[v * 3 + c] + N[v * 3 + c] * h[v]; }
  let mx = 0, s = 0; for (let v = 0; v < n; v++) { mx = Math.max(mx, h[v]); s += h[v]; } return { verts: k, maxMm: +(mx * 1000).toFixed(2), meanMm: +(s / Math.max(1, k) * 1000).toFixed(2) };
}
const q4 = X => Float64Array.from(X, x => Math.round(x * 1e4) / 1e4);
// a molded cup: the region smoothed (Laplacian, its rim held by the falloff), then lifted along the normal by the most the fit stood out
// of the smooth surface (so the dome covers every bump it smoothed away), the lift faded to the rim
function dome(X, T, wOf, maxLift, its = 40) {
  const n = X.length / 3, N = vertexNormals(X, T), nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { nb[T[t + k]].add(T[t + (k + 1) % 3]); nb[T[t + k]].add(T[t + (k + 2) % 3]); }
  const w = new Float64Array(n); for (let v = 0; v < n; v++) w[v] = wOf(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); const X0 = Float64Array.from(X), Y = Float64Array.from(X);
  for (let it = 0; it < its; it++) { for (let v = 0; v < n; v++) { if (!w[v] || !nb[v].size) continue; let sx = 0, sy = 0, sz = 0; for (const u of nb[v]) { sx += X[u * 3]; sy += X[u * 3 + 1]; sz += X[u * 3 + 2]; } const c = nb[v].size, k = 0.5 * w[v];
      Y[v * 3] = X[v * 3] + k * (sx / c - X[v * 3]); Y[v * 3 + 1] = X[v * 3 + 1] + k * (sy / c - X[v * 3 + 1]); Y[v * 3 + 2] = X[v * 3 + 2] + k * (sz / c - X[v * 3 + 2]); } X.set(Y); }
  let need = 0; for (let v = 0; v < n; v++) if (w[v] > 0.6) need = Math.max(need, (X0[v * 3] - X[v * 3]) * N[v * 3] + (X0[v * 3 + 1] - X[v * 3 + 1]) * N[v * 3 + 1] + (X0[v * 3 + 2] - X[v * 3 + 2]) * N[v * 3 + 2]);
  const L = Math.min(maxLift, Math.max(0, need)); for (let v = 0; v < n; v++) if (w[v]) for (let c = 0; c < 3; c++) X[v * 3 + c] += N[v * 3 + c] * L * w[v];
  let mv = 0; for (let v = 0; v < n; v++) mv = Math.max(mv, Math.hypot(X[v * 3] - X0[v * 3], X[v * 3 + 1] - X0[v * 3 + 1], X[v * 3 + 2] - X0[v * 3 + 2])); return { liftMm: +(L * 1000).toFixed(2), needMm: +(need * 1000).toFixed(2), maxMoveMm: +(mv * 1000).toFixed(2) };
}
export function finishFound8(parts, { f8 = F8_DEFAULT, log = () => {} } = {}) {
  const rep = {}, F = parts.filter(q => q.group === 'found'), shellOf = id => F.find(q => q.owner === id && q.name === 'shell');
  // what is sewn on each shell (bindings, straps), bound to it before it moves
  const carry = (shell, fn) => { const sewn = F.filter(q => q.owner === shell.owner && q !== shell), B = sewn.map(q => bind8(q.X, shell.X, shell.T, { reach: 0.02 })), X0 = Float64Array.from(shell.X);
    const r = fn(shell); const mv = new Uint8Array(shell.X.length / 3); for (let v = 0; v < mv.length; v++) if (Math.abs(shell.X[v * 3] - X0[v * 3]) + Math.abs(shell.X[v * 3 + 1] - X0[v * 3 + 1]) + Math.abs(shell.X[v * 3 + 2] - X0[v * 3 + 2]) > 1e-6) mv[v] = 1;
    sewn.forEach((q, i) => { const Xq = Float64Array.from(q.X); if (place8(B[i], shell.X, shell.T, Xq, mv)) q.X = q4(Xq); }); shell.X = q4(shell.X); return r; };
  // the bra: straps sewn into the cup's top edge, the cups lifted over their dents
  const bra = shellOf('bra');
  if (bra && f8.strapSew) { const S = new SurfaceMesh(bra.X, Int32Array.from(bra.T), { cell: 0.015, boundary: true }); rep.straps = {};
    for (let pi = 0; pi < parts.length; pi++) { const q = parts[pi]; if (q.group !== 'found' || q.owner !== 'bra' || !/^strap\./.test(q.name)) continue; const nv = q.X.length / 3, np = 6; if (nv % np) continue; const rows = nv / np;
      const on = r => { let x = 0, y = 0, z = 0; for (let k = 0; k < np; k++) { const v = r * np + k; x += q.X[v * 3]; y += q.X[v * 3 + 1]; z += q.X[v * 3 + 2]; } const c = S.closest(x / np, y / np, z / np, 0.006); return !!c && !c.edge && Math.abs(c.d) < 0.005; };
      if (!on(0)) { rep.straps[q.name] = { onCup: 0 }; continue; } let r1 = 0; while (r1 < rows - 2 && on(r1)) r1++; const r0 = Math.max(0, r1 - 1);
      const keep = v => Math.floor(v / np) >= r0, map = new Int32Array(nv).fill(-1); let m = 0; for (let v = 0; v < nv; v++) if (keep(v)) map[v] = m++;
      const sub = (A, k) => { const out = new A.constructor(m * k); for (let v = 0; v < nv; v++) if (map[v] >= 0) for (let c = 0; c < k; c++) out[map[v] * k + c] = A[v * k + c]; return out; };
      const reT = T => { const o = []; for (let t = 0; t < T.length; t += 3) if (map[T[t]] >= 0 && map[T[t + 1]] >= 0 && map[T[t + 2]] >= 0) o.push(map[T[t]], map[T[t + 1]], map[T[t + 2]]); return Int32Array.from(o); };
      const X = sub(q.X, 3);
      // its first row pressed flat into the cup's edge (0.5 mm proud: under the binding)
      for (let k = 0; k < np; k++) { const v = k, c = S.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.01); if (c) { X[v * 3] = c.px + c.nx * 0.0005; X[v * 3 + 1] = c.py + c.ny * 0.0005; X[v * 3 + 2] = c.pz + c.nz * 0.0005; } }
      parts[pi] = { ...q, X: q4(X), SI: sub(q.SI, 4), SW: sub(q.SW, 4), uv: sub(q.uv, 2), T: reT(q.T), ...(q.Tfull ? { Tfull: reT(q.Tfull) } : {}), cloth8: 'strap' };
      rep.straps[q.name] = { rowsOff: r0, of: rows, mmOff: +(r0 * 0.0 + 0).toFixed(0) }; }
    F.splice(0, F.length, ...parts.filter(q => q.group === 'found')); }
  if (bra && f8.cupLift > 0) { const b2 = shellOf('bra'); let apex = [null, null]; for (let v = 0; v < b2.X.length / 3; v++) { const s = b2.X[v * 3] >= 0 ? 0 : 1; if (!apex[s] || b2.X[v * 3 + 2] > apex[s][2]) apex[s] = [b2.X[v * 3], b2.X[v * 3 + 1], b2.X[v * 3 + 2]]; }
    rep.cups = carry(b2, sh => dome(sh.X, sh.T, (x, y, z) => Math.max(...apex.filter(Boolean).map(a => 1 - sstep(0.025, 0.045, Math.hypot(x - a[0], y - a[1], z - a[2])))), f8.cupLift)); }
  // the briefs: the shell bridging the fork
  const br = shellOf('briefs');
  if (br && f8.bridge > 0) { let yCr = Infinity; for (let v = 0; v < br.X.length / 3; v++) if (Math.abs(br.X[v * 3]) < 0.03) yCr = Math.min(yCr, br.X[v * 3 + 1]);
    rep.briefs = carry(br, sh => lift(sh.X, sh.T, (x, y) => (1 - sstep(0.05, 0.075, Math.abs(x))) * (1 - sstep(yCr + 0.08, yCr + 0.12, y)), f8.bridge)); rep.briefs.yCr = +yCr.toFixed(3); }
  log('found8', JSON.stringify(rep).slice(0, 500)); return rep;
}
