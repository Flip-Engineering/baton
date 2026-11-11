// FABRIC7 ridge7 (c5 it4): the crease model of fabric6.js's wrinkle cascade (F6_WRINKLE under F6_CASCADE) as plain functions, ONE source for the two places that realize it outside the shader:
//   labs/clothing2/fabric7_ridge_ref.mjs   the shader's block ported (the function plots, pattern maps and the excess-length check)
//   fabric7/crease7.js                     (uses hh and RIDGE) the creases the mesh can carry as GEOMETRY, placed by a cause (fold7.js applies them)
// The shader's GLSL is the third copy (line for line; any change to the model is made in all three).
// Since 15 Oct fold7's only placement of the geometry's creases is crease7.js (nucleation at the places the cloth needs a fold, growth along the strain field's crest trajectory, height from the catchment's cloth); this hash-cell
// model (octaveStats / creases) is what the shader's FINER octaves still draw (a normal-only texture below the mesh's resolution, where where-a-fold-stands is not geometry) and what fabric7_ridge_ref.mjs ports for the function plots.
//
// THE MODEL, in one paragraph. Cloth far above its buckling strain does not undulate: its excess length (the compression the solved garment carries against its flat pattern, eps) goes into CREASES across
// the compression, each a rounded ridge A sech^2(u / w) with flat panels between, as long as several wavelengths (a Gaussian taper along the crease), laid in the compression direction th of the place. The excess is
// shared among octaves lambda_n = lambda_0 R^n up to the fold wavelength of the fabric (2.8 bending lengths) in proportion to R^(p n), p = 2 (bending energy of an absorbed length falls as 1 / lambda^2). Each
// octave's amplitude A0 is fixed by CONSERVATION OF THE EXCESS LENGTH: the creases' slope energy along the compression, summed over the area, is 2 eps_n (a sinusoid's is (A k)^2 / 2: the same law). The model's
// constants: crease half-width 0.22, crease length 1.6, spacing 1.0 (each in the octave's own wavelength), K = 3 creases a cell at most, direction jitter 0.4 rad; the slope cap of the fabric bounds every crease.
const fract = x => x - Math.floor(x), clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const hh = (x, y, z) => { let px = fract(x * 0.3183099 + 0.1), py = fract(y * 0.3183099 + 0.1), pz = fract(z * 0.3183099 + 0.1); px *= 17; py *= 17; pz *= 17; return fract(px * py * pz * (px + py + pz)); };
export const fFade = (w, a, b) => { const t = clamp((w - a) / (b - a), 0, 1); return 1 - t * t * (3 - 2 * t); };
export const RIDGE = { w: 0.22, len: 1.6, sp: 1.0, K: 3, dirJit: 0.4 };
export const SEED = 3.7;   // the port's stand-in for the shader's cSeed (a per-fabric constant)

// the statistics of ONE octave: eps the total excess (pi A / lambda_0)^2, ssum the sum of R^(p n) over the cascade's octaves, fn the octave's index
// sMax: the steepest a single crease may be (peak slope 0.77 A / w); the shader's is the fabric's fine-wrinkle cap x 2.4, fold7's is the steepest a fold can lie (45 deg)
export function octaveStats(eps, ssum, R, p, fn, lam, cap, sMax = cap * 2.4) {
  const lamN = lam * Math.pow(R, fn), epsN = eps * Math.pow(R, p * fn) / ssum, w = RIDGE.w * lamN, ell = RIDGE.len * lamN, Lc = 2 * ell, K = RIDGE.K;
  const dens = 1 / (RIDGE.sp * lamN * 1.7725 * ell), pr = Math.min(1, dens * Lc * Lc / K), dEff = K * pr / (Lc * Lc);
  let A0 = Math.sqrt(2 * epsN * w / (dEff * 1.0667 * ell * 1.2533));   // the slope energy along the compression, summed over the creases, is 2 eps
  A0 = Math.min(A0, sMax * w / 0.77);                                   // a single crease never steeper than the slope cap (peak slope of A sech^2(u / w) is 0.77 A / w)
  return { lamN, epsN, w, ell, Lc, K, pr, A0 };
}

// the creases of one octave at a point q (pattern metres) whose compression direction is th: [height, slope x, slope y]. amp = A0 x the octave's visibility; signed: the shader draws ridges and furrows
// at random (a normal map has no body to run into); the geometry takes ridges only (cloth lying on a body buckles away from it)
// hCap: no crease higher than this (the steepest a fold may lie: fold7.js applies it after the crease's strength factor, so the strongest of a field is held too)
export function creases(q, th, st, seed, fn, amp, signed = true, hCap = Infinity) {
  let hW = 0, gx = 0, gy = 0; const { w, ell, Lc, K, pr } = st, i0x = Math.floor(q[0] / Lc), i0y = Math.floor(q[1] / Lc);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ix = i0x + a, iy = i0y + b;
    for (let k = 0; k < K; k++) { const sd = seed + 21 + 7 * fn + 1.7 * k;
      if (hh(ix, iy, sd) > pr) continue;
      const cx = (ix + hh(ix, iy, sd + 2)) * Lc, cy = (iy + hh(ix, iy, sd + 4)) * Lc, dx = q[0] - cx, dy = q[1] - cy;
      const ta = th + (hh(ix, iy, sd + 6) - 0.5) * RIDGE.dirJit, ex = Math.cos(ta), ey = Math.sin(ta), u = dx * ex + dy * ey, v = -dx * ey + dy * ex, Su = u / w;
      if (Math.abs(Su) > 5 || Math.abs(v) > 2.2 * ell) continue;
      const r5 = hh(ix, iy, sd + 8), mag = (0.3 + 1.7 * r5 * r5 * r5) * 1.1486, sgn = signed ? (hh(ix, iy, sd + 10) < 0.5 ? -1 : 1) : 1;
      const eu = Math.exp(-Math.abs(Su)), s2 = 4 * eu * eu / ((1 + eu * eu) * (1 + eu * eu)), tn = Math.sign(Su) * (1 - eu * eu) / (1 + eu * eu), T = Math.exp(-(v * v) / (ell * ell));
      const hk = Math.min(amp * mag, hCap) * sgn * T * s2, du = -2 * hk * tn / w, dv = -2 * v / (ell * ell) * hk;
      hW += hk; gx += du * ex - dv * ey; gy += du * ey + dv * ex; } }
  return [hW, gx, gy];
}
