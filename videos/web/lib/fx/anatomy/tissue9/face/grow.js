// TISSUE9-FACE / GROW: THE REST STATE GROWN BY PACKING (16 Oct 2026, round 8 iteration 1). Pure JS, node or browser, no three.js.
// Every soft tissue of the region (a muscle, a fat compartment, a gland, the lips' mucosa, a fibrous laminate) is a BODY that grows from a
// thin SEED to its VOLUME inside the space the fixed parts (bone, cartilage, the globes, the tongue, the neck's core) and its neighbours leave
// it; where a growing body meets air its surface carries the skin's TENSION, where it meets a neighbour a fascial or septal interface, where
// it meets bone it adheres. The shape of every body is what this packing leaves: no profile, no thickness along a normal, no depth target.
// The model is the cellular Potts model (Graner and Glazier 1992, Phys Rev Lett 69:2013; Glazier and Graner 1993, Phys Rev E 47:2128; the
// tissue-packing form used for morphogenesis, e.g. Merks and Glazier 2005), at low temperature: a lattice of voxels, each owned by one body,
// the Hamiltonian
//     H = sum over neighbouring voxel pairs of J(class a, class b) [a != b]   (interface tensions: skin to air, fascia, septa, adhesion)
//       + sum over bodies of lambda_c (V_c - V*_c)^2                              (each body's volume; V* ramps from the seed to the volume)
//       + sum over voxels of the body's confinement (a muscle's fibres: a voxel is the muscle's only if a fibre from its origin to its
//         insertion of at most the fibre length passes through it; a fat lobule only inside the septa that bound its compartment)
// minimised by Metropolis copy attempts at the bodies' boundaries (26-neighbourhood). Growth is SIMULTANEOUS within a phase (every body's
// V* ramps together) and the phases follow the anatomy's own order (the muscles and glands, then the deep fat, then the superficial fat),
// each later body packing round the earlier ones, which stay mutable (they are pressed and reshaped, keeping their volume).
// Why not soft/'s elastic growth (Fg = g I) for this step: a body grown 10-40x from a seed on a fixed embedded grid degenerates its elements
// and soft/ has no contact between separate bodies; the packing is solved here, and soft/ (the XPBD solver) takes the grown rest state for
// the loaded one (gravity, the prestressed skin, the ligaments as tethers: DESIGN.md).
//   const L = lattice(origin, h, dims)                    // L.lab Uint8Array (0 = outside air), L.idx(i, j, k), L.ijk(n), L.pos(n)
//   const R = growPotts(L, bodies, J, { phases, T, seed, log })
// bodies[id] (id 1..254; id 0 = outside air, 255 = the lattice's border): { name, cls, fixed (immutable: bone, a hole), V (the volume in
//   voxels, 0 = none), lam (default 200 / V: a relative volume stiffness), allow(n) -> bool (the confinement, voxel index n), pen (the soft
//   territory: { map: Uint8Array over the lattice, P }: a voxel whose territory is another body's costs P), phase (0, 1, 2 ..) }
// J: { n (classes), m: Float32Array n x n (symmetric), same: Float32Array n (two bodies of one class) }; class 0 = air
export const GROW_VERSION = 1;
export function lattice(origin, h, dims) {
  const [nx, ny, nz] = dims, N = nx * ny * nz, lab = new Uint8Array(N);
  const idx = (i, j, k) => (k * ny + j) * nx + i, ijk = n => { const i = n % nx, t = (n - i) / nx, j = t % ny; return [i, j, (t - j) / ny]; };
  const pos = n => { const [i, j, k] = ijk(n); return [origin[0] + i * h, origin[1] + j * h, origin[2] + k * h]; };
  const at = (x, y, z) => { const i = Math.round((x - origin[0]) / h), j = Math.round((y - origin[1]) / h), k = Math.round((z - origin[2]) / h); return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : idx(i, j, k); };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) lab[idx(i, j, k)] = 255;
  return { origin, h, dims, N, lab, idx, ijk, pos, at };
}
// a small fast deterministic generator (xorshift128+ folded to [0, 1))
function rng(seed) { let a = (seed ^ 0x9e3779b9) >>> 0 || 1, b = 0x243f6a88, c = 0x85a308d3, d = 0x13198a2e;
  return () => { const t = a ^ (a << 11); a = b; b = c; c = d; d = (d ^ (d >>> 19) ^ (t ^ (t >>> 8))) >>> 0; return d / 4294967296; }; }

export function growPotts(L, bodies, J, o = {}) {
  const t0 = Date.now(), [nx, ny, nz] = L.dims, lab = L.lab, N = L.N, sx = 1, sy = nx, sz = nx * ny, rnd = rng(o.seed ?? 1);
  const off = []; for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) off.push(dx * sx + dy * sy + dz * sz);
  const OFF = Int32Array.from(off), NO = OFF.length;
  // per body: class, fixed, volume and target, its lambda
  const cls = new Uint8Array(256), fixed = new Uint8Array(256), V = new Float64Array(256), Vf = new Float64Array(256), Vt = new Float64Array(256), lam = new Float64Array(256), active = new Uint8Array(256), phaseOf = new Int16Array(256).fill(-1);
  fixed[255] = 1; cls[255] = 0; cls[0] = 0;
  for (let id = 1; id < 255; id++) { const b = bodies[id]; if (!b) continue; cls[id] = b.cls; fixed[id] = b.fixed ? 1 : 0; Vf[id] = b.V || 0; lam[id] = b.lam ?? (b.V > 0 ? (o.kappa ?? 200) / b.V : 0); phaseOf[id] = b.phase ?? 0; }
  for (let n = 0; n < N; n++) V[lab[n]]++;
  const Jm = J.m, Js = J.same, nc = J.n;
  const Jab = (a, b) => (a === b ? 0 : cls[a] === cls[b] ? Js[cls[a]] : Jm[cls[a] * nc + cls[b]]);
  // the boundary list: voxels with a neighbour of another body, that are mutable (a growing body's or outside air)
  const inList = new Uint8Array(N); let list = new Int32Array(1 << 20), nl = 0;
  const push = n => { if (inList[n]) return; const s = lab[n]; if (s === 255 || (s !== 0 && fixed[s])) return; inList[n] = 1; if (nl === list.length) { const l2 = new Int32Array(list.length * 2); l2.set(list); list = l2; } list[nl++] = n; };
  // a CANDIDATE: a voxel some neighbour could copy into (an active growing body's neighbour, or a tissue voxel next to air: it may retreat)
  const okSrc = (t, s) => t !== s && t !== 255 && (t === 0 ? s !== 0 : active[t] === 1 && !fixed[t]);
  const isB = n => { const s = lab[n]; for (let q = 0; q < NO; q++) if (okSrc(lab[n + OFF[q]], s)) return true; return false; };
  const rebuild = () => { inList.fill(0); nl = 0; for (let n = 0; n < N; n++) { const s = lab[n]; if (s === 255 || (s !== 0 && fixed[s])) continue; if (s !== 0 && !active[s]) continue; if (isB(n)) push(n); } };
  const allowF = new Array(256).fill(null), pen = new Array(256).fill(null);
  for (let id = 1; id < 255; id++) { const b = bodies[id]; if (!b) continue; if (b.allow) allowF[id] = b.allow; if (b.pen) pen[id] = b.pen; }
  const penAt = (s, n) => { const p = pen[s]; return p && p.map[n] !== s ? p.P : 0; };
  const hist = [], phases = o.phases || [{ sweeps: 60, T: 0.6 }];
  let att = 0, acc = 0;
  for (let ph = 0; ph < phases.length; ph++) {
    const P = phases[ph], tPh = Date.now();
    for (let id = 1; id < 255; id++) if (bodies[id] && !fixed[id]) active[id] = phaseOf[id] <= (P.upTo ?? ph) ? 1 : 0;
    if (o.beforePhase) { o.beforePhase(ph); V.fill(0); for (let n = 0; n < N; n++) V[lab[n]]++; }
    rebuild();
    const sweeps = P.sweeps, ramp = P.ramp ?? 0.6;
    for (let sw = 0; sw < sweeps; sw++) {
      const f = Math.min(1, (sw + 1) / Math.max(1, sweeps * ramp)), T = P.T0 != null ? P.T0 + (P.T - P.T0) * sw / Math.max(1, sweeps - 1) : P.T;
      // the targets of the bodies GROWING in this phase ramp from their volume at the phase's start to their own
      for (let id = 1; id < 255; id++) { if (!active[id] || !Vf[id]) continue; if (phaseOf[id] === (P.grow ?? ph)) { if (sw === 0) bodies[id]._V0 = V[id]; Vt[id] = bodies[id]._V0 + (Vf[id] - bodies[id]._V0) * f; } else Vt[id] = Vf[id]; }
      const n0 = nl;
      for (let a = 0; a < n0; a++) {
        if (nl === 0) break;
        const r = Math.floor(rnd() * nl), i = list[r];
        if (!isB(i)) { inList[i] = 0; list[r] = list[--nl]; continue; }
        const s = lab[i]; if (s !== 0 && (!active[s] || fixed[s])) { inList[i] = 0; list[r] = list[--nl]; continue; }
        let s2 = -1; for (let tr = 0; tr < 6; tr++) { const t = lab[i + OFF[Math.floor(rnd() * NO)]]; if (okSrc(t, s)) { s2 = t; break; } }
        if (s2 < 0) continue;
        att++;
        if (s2 !== 0 && allowF[s2] && !allowF[s2](i)) continue;
        let dH = 0; for (let q = 0; q < NO; q++) { const t = lab[i + OFF[q]]; dH += Jab(s2, t) - Jab(s, t); }
        if (s2 !== 0 && lam[s2]) dH += lam[s2] * (2 * (V[s2] - Vt[s2]) + 1);
        if (s !== 0 && lam[s]) dH += lam[s] * (-2 * (V[s] - Vt[s]) + 1);
        if (s2 !== 0 && bodies[s2].P) dH -= bodies[s2].P;      // a laminate's pressure: it fills what its confinement allows
        if (s !== 0 && bodies[s].P) dH += bodies[s].P;
        dH += penAt(s2, i) - penAt(s, i);
        if (dH > 0 && rnd() >= Math.exp(-dH / T)) continue;
        lab[i] = s2; V[s]--; V[s2]++; acc++;
        for (let q = 0; q < NO; q++) push(i + OFF[q]);
      }
      if (o.log && (sw % (o.logEvery ?? 10) === 0 || sw === sweeps - 1)) o.log(`  phase ${ph} sweep ${sw}/${sweeps} T ${T.toFixed(2)} boundary ${nl} attempts ${att} accepted ${acc} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    hist.push({ phase: ph, ms: Date.now() - tPh, boundary: nl });
  }
  const vol = {}; for (let id = 1; id < 255; id++) if (bodies[id] && !bodies[id].fixed) vol[bodies[id].name] = { V: V[id], target: Vf[id], err: Vf[id] ? +((V[id] - Vf[id]) / Vf[id] * 100).toFixed(1) : null };
  return { V, vol, attempts: att, accepted: acc, phases: hist, ms: Date.now() - t0 };
}

// GEODESIC DISTANCE in the lattice (26-neighbourhood Dijkstra with the steps' true lengths, a binary heap) from a set of source voxels,
// through the voxels pass(n) allows, inside a box [i0, j0, k0, i1, j1, k1]; returns { d: Float32Array over the box (Infinity unreached),
// box, at(n) (the distance at a lattice voxel; Infinity outside the box) }. A muscle's fibres bend round the bone: its reach is the sum of
// the geodesic distances to its origin and its insertion, never the straight line through the bone.
export function geodesic(L, sources, pass, box, maxD = Infinity) {
  const [nx, ny] = L.dims, [i0, j0, k0, i1, j1, k1] = box, bx = i1 - i0 + 1, by = j1 - j0 + 1, bz = k1 - k0 + 1, M = bx * by * bz, d = new Float32Array(M).fill(Infinity), h = L.h;
  const loc = n => { const i = n % nx, t = (n - i) / nx, j = t % ny, k = (t - j) / ny; if (i < i0 || i > i1 || j < j0 || j > j1 || k < k0 || k > k1) return -1; return ((k - k0) * by + (j - j0)) * bx + (i - i0); };
  const hv = [], hk = []; const hpush = (v, key) => { hv.push(v); hk.push(key); let c = hv.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (hk[p] <= hk[c]) break; [hv[p], hv[c]] = [hv[c], hv[p]]; [hk[p], hk[c]] = [hk[c], hk[p]]; c = p; } };
  const hpop = () => { const v = hv[0], k = hk[0], lv = hv.pop(), lk = hk.pop(); if (hv.length) { hv[0] = lv; hk[0] = lk; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hv.length && hk[l] < hk[m]) m = l; if (r < hv.length && hk[r] < hk[m]) m = r; if (m === c) break; [hv[m], hv[c]] = [hv[c], hv[m]]; [hk[m], hk[c]] = [hk[c], hk[m]]; c = m; } } return [v, k]; };
  const steps = []; for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) steps.push([dx, dy, dz, h * Math.hypot(dx, dy, dz)]);
  for (const s of sources) { const q = loc(s); if (q < 0) continue; d[q] = 0; hpush(q, 0); }
  while (hv.length) { const [q, k] = hpop(); if (k > d[q] || k > maxD) continue; const ii = q % bx, t = (q - ii) / bx, jj = t % by, kk = (t - jj) / by;
    for (const [dx, dy, dz, w] of steps) { const a = ii + dx, b = jj + dy, c = kk + dz; if (a < 0 || b < 0 || c < 0 || a >= bx || b >= by || c >= bz) continue; const q2 = (c * by + b) * bx + a, nk = k + w; if (nk >= d[q2]) continue;
      if (!pass(((c + k0) * ny + (b + j0)) * nx + (a + i0))) continue; d[q2] = nk; hpush(q2, nk); } }
  return { d, box, at: n => { const q = loc(n); return q < 0 ? Infinity : d[q]; } };
}
