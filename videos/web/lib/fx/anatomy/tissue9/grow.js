// ANATOMY / TISSUE9 / GROW (TISSUE9-LIMB, round 8, 16 Oct 2026; DESIGN: review/studio_human_c8/after/tissue9_limb/DESIGN.md): THE REST STATE GROWN.
// Every tissue of a region (each muscle, each fat compartment, the deep fat bodies, the tendons) is a PHASE of one voxel volume: it starts as its SEED
// (the muscle's fibres from origin to insertion on the person's own bones; a fat compartment's patch of the deep fascia) and GROWS to its VOLUME (the
// input: lean mass, DXA, CT / MRI volumetry) in the space the bones, the fixed tissues and its neighbours leave it. The shape is the equilibrium of
// packing: incompressible bodies of given volume, each bounded by a membrane with a TENSION (the deep fascia, the epimysium and the septa, the skin and
// its superficial fascia), pressed against one another and the bone. Nothing is sized to a contour: no profile, no radius, no thickness along a normal.
//
// THE METHOD: volume-constrained multiphase threshold dynamics (the MBO scheme: Merriman, Bence and Osher 1994; for arbitrary surface tensions between
// many phases, Esedoglu and Otto 2015, Comm Pure Appl Math 68:808, 'Threshold dynamics for networks with arbitrary surface tensions'; volume constraints
// by per-phase thresholds as in Ruuth and Wetton 2003 and the auction dynamics of Jacobs, Merkurjev and Esedoglu 2018, J Comput Phys 354:288). One step:
// each phase's indicator is convolved with a Gaussian (psi_i = G * chi_i); each free voxel goes to the phase k that minimises
//   c_k(x) - lambda_k,   c_k(x) = sum_j sigma_kj psi_j(x) + f_k(x)
// where sigma_kj is the tension of the interface between k and j and lambda_k the phase's PRESSURE, set so that the phase holds its target volume (the
// growth's schedule ramps it from the seed's to the full); f_k an external potential (the zones of adherence). The step is a gradient step of the
// interface energy sum sigma_ij Area_ij at fixed volumes (Esedoglu and Otto), so the bodies relax to the packed, tension-balanced form. Each phase is
// kept CONNECTED to its seed (a phase is one body, grown from its seed), and its seed is pinned.
//
//   import { grow } from '.../anatomy/tissue9/grow.js'
//   const R = grow(G, L, phases, { sigma, steps, sigmaK, eps, potential, log })
//     G the grid (grid.js makeGrid); L Uint16Array(G.n) the labels (0 = air), edited in place
//     phases[k] = { name, group, fixed, V (m3 target or null = free volume), seeds (Int32Array of voxels, pinned) }  (k = the label; phases[0] is air)
//     sigma(k, j) the tension (dimensionless, the skin's = 1); steps { grow, relax }; sigmaK the kernel's sigma (voxels)
//   -> { steps, ms, phases: [{ name, V, Vt, lambda }] }
import { gauss1, blurBox } from './grid.js';

export function grow(G, L, phases, o = {}) {
  const t0 = Date.now(), { nx, ny, nz } = G, nxy = nx * ny, nP = phases.length, K = gauss1(o.sigmaK ?? 1.4), R = K.r + 1, h3 = G.h ** 3;
  const nGrow = o.steps?.grow ?? 12, nRelax = o.steps?.relax ?? 8, nInner = o.inner ?? 8, damp = o.damp ?? 0.5, epsC = o.eps ?? 0.02, log = o.log || null;
  const active = new Uint8Array(nP); for (let k = 1; k < nP; k++) active[k] = phases[k].fixed ? 0 : 1;
  // the tension table
  const S = new Float32Array(nP * nP); for (let a = 0; a < nP; a++) for (let b = 0; b < nP; b++) S[a * nP + b] = a === b ? 0 : o.sigma(a, b);
  // pinned seeds
  const pin = new Uint8Array(G.n), nPin = new Int32Array(nP);
  for (let k = 1; k < nP; k++) { const sd = phases[k].seeds; if (!sd) continue; for (const v of sd) { if (pin[v] || (L[v] && phases[L[v]].fixed)) continue; L[v] = k; pin[v] = 1; nPin[k]++; } }
  // fixed voxels: a fixed phase's, and air marked fixed by the caller (o.fixedAir: Uint8Array)
  const fixedV = new Uint8Array(G.n); for (let v = 0; v < G.n; v++) if ((L[v] && phases[L[v]].fixed) || (o.fixedAir && o.fixedAir[v] && L[v] === 0)) fixedV[v] = 1;
  // the target voxel counts
  // the growth starts from each phase's body as given (its seeds, or the shell a fat compartment starts as) and ramps to its full volume
  const n0 = new Float64Array(nP); for (let v = 0; v < G.n; v++) n0[L[v]]++;
  const Nfull = new Float64Array(nP), Nseed = new Float64Array(nP); for (let k = 1; k < nP; k++) if (active[k] && phases[k].V != null) { Nfull[k] = Math.max(nPin[k], phases[k].V / h3); Nseed[k] = Math.min(n0[k], Nfull[k]); }
  const lambda = new Float64Array(nP);
  // psi boxes: { bb: [i0, j0, k0, a, b, c], a: Float32Array }
  const psi = new Array(nP).fill(null);
  // the voxels of every phase (rebuilt each step by one sweep)
  const boxes = new Int32Array(nP * 6);
  const sweepBoxes = () => { for (let k = 0; k < nP; k++) { boxes[k * 6] = boxes[k * 6 + 1] = boxes[k * 6 + 2] = 1 << 30; boxes[k * 6 + 3] = boxes[k * 6 + 4] = boxes[k * 6 + 5] = -1; }
    for (let k3 = 0, v = 0; k3 < nz; k3++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, v++) { const k = L[v]; if (!k) continue; const b = k * 6;
      if (i < boxes[b]) boxes[b] = i; if (j < boxes[b + 1]) boxes[b + 1] = j; if (k3 < boxes[b + 2]) boxes[b + 2] = k3; if (i > boxes[b + 3]) boxes[b + 3] = i; if (j > boxes[b + 4]) boxes[b + 4] = j; if (k3 > boxes[b + 5]) boxes[b + 5] = k3; } };
  const makePsi = k => { const b = k * 6; if (boxes[b + 3] < 0) return null;
    const i0 = Math.max(0, boxes[b] - R), j0 = Math.max(0, boxes[b + 1] - R), k0 = Math.max(0, boxes[b + 2] - R), i1 = Math.min(nx - 1, boxes[b + 3] + R), j1 = Math.min(ny - 1, boxes[b + 4] + R), k1 = Math.min(nz - 1, boxes[b + 5] + R);
    const a = i1 - i0 + 1, bb = j1 - j0 + 1, c = k1 - k0 + 1, A = new Float32Array(a * bb * c);
    for (let kk = 0; kk < c; kk++) for (let jj = 0; jj < bb; jj++) { const vo = i0 + nx * (j0 + jj) + nxy * (k0 + kk), ao = a * (jj + bb * kk); for (let ii = 0; ii < a; ii++) if (L[vo + ii] === k) A[ao + ii] = 1; }
    blurBox(A, [a, bb, c], K); return { i0, j0, k0, a, b: bb, c, A }; };
  const psiAt = (P, i, j, k) => { const ii = i - P.i0, jj = j - P.j0, kk = k - P.k0; if (ii < 0 || jj < 0 || kk < 0 || ii >= P.a || jj >= P.b || kk >= P.c) return 0; return P.A[ii + P.a * (jj + P.b * kk)]; };
  // block index (8^3 voxels a block): the phases whose psi box meets the block
  const BS = 8, bx = Math.ceil(nx / BS), by = Math.ceil(ny / BS), bz = Math.ceil(nz / BS);
  const buildBlocks = () => { const lists = Array.from({ length: bx * by * bz }, () => []);
    for (let k = 1; k < nP; k++) { const P = psi[k]; if (!P) continue; const ib0 = Math.floor(P.i0 / BS), ib1 = Math.floor((P.i0 + P.a - 1) / BS), jb0 = Math.floor(P.j0 / BS), jb1 = Math.floor((P.j0 + P.b - 1) / BS), kb0 = Math.floor(P.k0 / BS), kb1 = Math.floor((P.k0 + P.c - 1) / BS);
      for (let q = kb0; q <= kb1; q++) for (let w = jb0; w <= jb1; w++) for (let u = ib0; u <= ib1; u++) lists[u + bx * (w + by * q)].push(k); }
    return lists; };
  const pot = o.potential || null, col = o.column || null, colOn = !!col;   // (k, v) -> extra cost (zones of adherence), or null
  const stamp = new Int32Array(G.n); let stampN = 0;
  const hist = [];
  // fixed phases' psi once
  sweepBoxes(); for (let k = 1; k < nP; k++) if (!active[k]) psi[k] = makePsi(k);
  const nSteps = nGrow + nRelax;
  for (let step = 0; step < nSteps; step++) {
    const ramp = Math.min(1, (step + 1) / nGrow), Nt = new Float64Array(nP); for (let k = 1; k < nP; k++) if (active[k] && phases[k].V != null) Nt[k] = Nseed[k] + (Nfull[k] - Nseed[k]) * ramp;
    sweepBoxes(); for (let k = 1; k < nP; k++) if (active[k]) psi[k] = makePsi(k);
    const blocks = buildBlocks();
    // the band: free, unpinned voxels within reach of an active phase; per voxel its candidates and their costs (CSR)
    const bandV = [], cStart = [0], cId = [], cCost = [], frozen = new Float64Array(nP);
    const pj = new Float32Array(nP), touched = [];
    for (let kb = 0; kb < bz; kb++) for (let jb = 0; jb < by; jb++) for (let ib = 0; ib < bx; ib++) { const lst = blocks[ib + bx * (jb + by * kb)]; let anyActive = false; for (const k of lst) if (active[k]) { anyActive = true; break; } if (!anyActive) continue;
      for (let k3 = kb * BS; k3 < Math.min(nz, kb * BS + BS); k3++) for (let j = jb * BS; j < Math.min(ny, jb * BS + BS); j++) for (let i = ib * BS; i < Math.min(nx, ib * BS + BS); i++) {
        const v = i + nx * j + nxy * k3; if (fixedV[v] || pin[v]) continue;
        let sum = 0, nAct = 0; touched.length = 0;
        for (const k of lst) { const p = psiAt(psi[k], i, j, k3); if (p > 1e-4) { pj[k] = p; touched.push(k); sum += p; if (active[k] && p > epsC) nAct++; } }
        const cur = L[v];
        if (!nAct && !(cur && active[cur])) { for (const k of touched) pj[k] = 0; continue; }
        const pAir = Math.max(0, 1 - sum);
        // a voxel deep inside one active phase with no other phase near: it cannot change this step (frozen in its phase's count)
        if (cur && active[cur] && pj[cur] > 0.995 && touched.length === 1) { frozen[cur]++; pj[cur] = 0; continue; }
        // candidates: air, the active phases present, the current label
        // a phase may take a voxel only on its own front (the voxel touches its body): growth, never a jump (no islands)
        const nb6 = [i > 0 ? L[v - 1] : 0, i < nx - 1 ? L[v + 1] : 0, j > 0 ? L[v - nx] : 0, j < ny - 1 ? L[v + nx] : 0, k3 > 0 ? L[v - nxy] : 0, k3 < nz - 1 ? L[v + nxy] : 0];
        // o.column (Int32Array, per voxel the phase whose column it lies in, -1 none): a phase marked column grows only inside its own column (the fat
        // lobules between the retinacula cutis: walls from the fascia to the dermis, bearing no tension of their own)
        bandV.push(v); const cand = [0]; for (const k of touched) if (active[k] && pj[k] > epsC && (k === cur || nb6.indexOf(k) >= 0) && !(colOn && phases[k].column && col[v] !== k)) cand.push(k); if (cur && active[cur] && cand.indexOf(cur) < 0) cand.push(cur);
        for (const k of cand) { let c = S[k * nP] * pAir; for (const j2 of touched) c += S[k * nP + j2] * pj[j2]; if (pot && k) c += pot(k, v); cId.push(k); cCost.push(c); }
        cStart.push(cId.length); for (const k of touched) pj[k] = 0; } }
    const nb = bandV.length, CS = Int32Array.from(cStart), CI = Int32Array.from(cId), CC = Float32Array.from(cCost), asg = new Int32Array(nb);
    // pinned counts per phase
    // the volume iterations: assign by argmin (c - lambda); then each phase's pressure set to give it its target count, the others held (Jacobi)
    const assign = () => { for (let b = 0; b < nb; b++) { let best = -1, bc = Infinity; for (let q = CS[b]; q < CS[b + 1]; q++) { const k = CI[q], c = CC[q] - lambda[k]; if (c < bc) { bc = c; best = k; } } asg[b] = best; } };
    for (let it = 0; it < nInner; it++) {
      assign();
      // per voxel the best and second-best (c - lambda); a phase's threshold at a voxel: tau = c_k - (best other)
      const lists = new Array(nP).fill(null), cnt = new Int32Array(nP);
      for (let q = 0; q < CI.length; q++) cnt[CI[q]]++;
      for (let k = 1; k < nP; k++) if (active[k] && phases[k].V != null && cnt[k]) lists[k] = { a: new Float32Array(cnt[k]), n: 0 };
      for (let b = 0; b < nb; b++) { let b1 = Infinity, k1 = -1, b2 = Infinity; for (let q = CS[b]; q < CS[b + 1]; q++) { const c = CC[q] - lambda[CI[q]]; if (c < b1) { b2 = b1; b1 = c; k1 = CI[q]; } else if (c < b2) b2 = c; }
        for (let q = CS[b]; q < CS[b + 1]; q++) { const k = CI[q], Lk = lists[k]; if (!Lk) continue; const other = k === k1 ? b2 : b1; Lk.a[Lk.n++] = CC[q] - other; } }
      for (let k = 1; k < nP; k++) { const Lk = lists[k]; if (!Lk) continue; const want = Math.round(Nt[k] - nPin[k] - frozen[k]); const A = Lk.a.subarray(0, Lk.n).sort();
        let lj; if (want <= 0) lj = (A.length ? A[0] : 0) - 1e-3; else if (want >= A.length) lj = A[A.length - 1] + 1e-3; else lj = 0.5 * (A[want - 1] + A[want]);
        lambda[k] = it === 0 || it === nInner - 1 ? lj : lambda[k] + damp * (lj - lambda[k]); }
    }
    assign();
    // EXACT VOLUMES (the trim and fill): a phase over its count gives up its least-held voxels (the largest margin) to their best other candidate that is
    // air or short of its own count; a phase short of its count takes the air voxels on its front where it is best placed (the smallest margin)
    { const cnt = new Float64Array(nP); for (let b = 0; b < nb; b++) cnt[asg[b]]++;
      const ex = new Float64Array(nP); for (let k = 1; k < nP; k++) if (active[k] && phases[k].V != null) ex[k] = cnt[k] + nPin[k] + frozen[k] - Math.round(Nt[k]);
      const best2 = (b, not) => { let bj = 0, bc = Infinity; for (let q = CS[b]; q < CS[b + 1]; q++) { const k = CI[q]; if (k === not || (k && ex[k] >= 0)) continue; const c = CC[q] - lambda[k]; if (c < bc) { bc = c; bj = k; } } return [bj, bc]; };
      const over = [], under = []; for (let k = 1; k < nP; k++) { if (ex[k] > 0) over.push(k); else if (ex[k] < 0) under.push(k); }
      if (over.length || under.length) {
        const mine = new Map(); for (const k of over) mine.set(k, []); const cands = new Map(); for (const k of under) cands.set(k, []);
        for (let b = 0; b < nb; b++) { const a = asg[b]; let ca = 0; for (let q = CS[b]; q < CS[b + 1]; q++) if (CI[q] === a) { ca = CC[q] - lambda[a]; break; }
          if (mine.has(a)) { const [, bc] = best2(b, a); mine.get(a).push([ca - bc, b]); }
          if (a === 0) for (let q = CS[b]; q < CS[b + 1]; q++) { const k = CI[q]; if (cands.has(k)) cands.get(k).push([CC[q] - lambda[k] - ca, b]); } }
        for (const k of over) { const A = mine.get(k).sort((x, y) => y[0] - x[0]); let n = ex[k]; for (const [, b] of A) { if (n <= 0) break; const [j] = best2(b, k); asg[b] = j; if (j) ex[j]++; n--; } ex[k] = n; }
        for (const k of under) { const A = cands.get(k).sort((x, y) => x[0] - y[0]); let n = -ex[k]; for (const [, b] of A) { if (n <= 0) break; if (asg[b] !== 0) continue; asg[b] = k; n--; } ex[k] = -n; } } }
    for (let b = 0; b < nb; b++) L[bandV[b]] = asg[b];
    // connectivity: every phase one body, connected to its seed (6-neighbours); an island goes to its best other candidate (air if none)
    const isl = connect(G, L, phases, active, pin, stamp, ++stampN);
    // an island (cut off from its seed) stays the same tissue: it goes to the best candidate of its own group (a neighbouring fat lobule takes a
    // lobule's cut-off piece), else to air; never to another kind of tissue
    if (isl.length) { const where = new Map(); for (let b = 0; b < nb; b++) where.set(bandV[b], b);
      for (const v of isl) { const b = where.get(v), k0 = L[v], g0 = phases[k0].group; let best = 0, bc = Infinity;
        if (b !== undefined) for (let q = CS[b]; q < CS[b + 1]; q++) { const k = CI[q]; if (k === k0 || !k || phases[k].group !== g0) continue; const c = CC[q] - lambda[k]; if (c < bc) { bc = c; best = k; } }
        L[v] = best; } }
    stampN++;
    if (log && (step % 4 === 3 || step === nSteps - 1)) { const cnt = new Float64Array(nP); for (let v = 0; v < G.n; v++) cnt[L[v]]++; let err = 0, m = 0; for (let k = 1; k < nP; k++) if (active[k] && Nt[k] > 0) { err += Math.abs(cnt[k] / Nt[k] - 1); m++; }
      log({ step, band: nb, islands: isl.length, meanVolErrPct: +(err / Math.max(1, m) * 100).toFixed(2), ms: Date.now() - t0 }); }
  }
  const cntF = new Float64Array(nP); for (let v = 0; v < G.n; v++) cntF[L[v]]++;
  return { steps: nSteps, ms: Date.now() - t0, phases: phases.map((p, k) => ({ name: p.name, Vcm3: +(cntF[k] * h3 * 1e6).toFixed(1), Vtcm3: p.V != null ? +(p.V * 1e6).toFixed(1) : null, lambda: +lambda[k].toFixed(3) })) };
}

// each active phase keeps the voxels connected to its pinned seeds; returns the islands (voxels cut off)
function connect(G, L, phases, active, pin, stamp, sN) {
  const { nx, ny, nz } = G, nxy = nx * ny, out = [], q = new Int32Array(G.n); let qh = 0, qt = 0;
  for (let v = 0; v < G.n; v++) if (pin[v] && active[L[v]] && stamp[v] !== sN) { stamp[v] = sN; q[qt++] = v; }
  // 26-neighbours: a body is connected through its edges and corners too (a thin lobule one voxel thick stays one body on a slant)
  while (qh < qt) { const v = q[qh++], k = L[v], i = v % nx, j = Math.floor(v / nx) % ny, k3 = Math.floor(v / nxy);
    for (let dk = -1; dk <= 1; dk++) { const kk = k3 + dk; if (kk < 0 || kk >= nz) continue; for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= ny) continue;
      for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= nx) continue; const w = ii + nx * jj + nxy * kk; if (stamp[w] !== sN && L[w] === k) { stamp[w] = sN; q[qt++] = w; } } } } }
  for (let v = 0; v < G.n; v++) { const k = L[v]; if (k && active[k] && stamp[v] !== sN) out.push(v); }
  return out;
}

// the smoothed indicator of a set of labels over the whole grid (the field a surface is taken from: its 0.5 level is the MBO interface)
export function groupField(G, L, inGroup, sigmaK = 1.4) {
  const A = new Float32Array(G.n); for (let v = 0; v < G.n; v++) if (inGroup(L[v])) A[v] = 1;
  return blurBox(A, [G.nx, G.ny, G.nz], gauss1(sigmaK));
}
