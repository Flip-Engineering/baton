// ANATOMY / FINE: THE VERMILION'S FURROWS AS WRINKLING (DETAIL7, c6 iteration 20, 15 Oct 2026). Ours, CC0.
// The lip print (the sulci labiorum) is not drawn. The vermilion is a thin stiff film (its stratum corneum: thin, para-keratinized, no
// glands) on a soft substrate (the viable epithelium over the lamina propria and the orbicularis oris). The muscle's resting tone shortens
// the lip along its fibres, the film cannot shorten with it, and it buckles: the furrows run ACROSS the fibres (vertical at the lip's middle,
// slanting where the fibres curve into the modiolus). What a person's lip print looks like follows from four things, each from the person:
//   1. WHERE AND HOW MUCH the lip is compressed: the orbicularis' tone along its fibres (the fibres follow the lip's own outline: MOUTH's
//      wet line and borders; the curves between them are the fibres), concentrated where the same muscle force passes through a narrower
//      lip toward the commissure (stress ~ 1 / the lip's height), a transverse squeeze where the lip narrows into the corner (so the corner's
//      compression is BIAXIAL: there the pattern loses its direction and branches), and the white roll's tension at the border (the
//      tubercle's own stretch is written but OFF: LIP_FILM.bulge says why); the vermilion's age volume loss leaves more
//      excess epithelium (x (1 + laxTone * laxity)).
//   2. THE FILM: the stratum corneum's modulus with its HYDRATION (wet at the wet line, drying toward the border over Lh; a person's lips
//      drier with age), its thickness ramping in over Lk from the non-keratinized mucosa. The film-on-substrate results (Allen 1969; Chen &
//      Hutchinson 2004; Cerda & Mahadevan 2003): wavelength lambda = 2 pi h (Ef / 3 Es)^(1/3), the onset strain eps_c = (1/4) (3 Es / Ef)^(2/3),
//      the amplitude A = h sqrt(eps / eps_c - 1). Dry film: longer, deeper furrows; wet: fine and shallow.
//   3. THE PATTERN: a Swift-Hohenberg phase field on the lip (pseudo-spectral, semi-implicit), its control parameter the local supercriticality
//      (ln eps / eps_c), its preferred wavenumber the local film's, its orientation penalty the local compression's anisotropy along the
//      fibres' normal. Stripes where the compression is uniaxial, labyrinths where it is biaxial, Y-junctions where the wavelength changes
//      (toward the wet line) or the fibres turn: the lip print's types (Suzuki & Tsuchihashi 1970: complete, incomplete, branched,
//      intersected, reticular) come out as outcomes, never chosen. The seed is the person's own (a lip print is individual).
//   4. THE SECTION: a buckled film far past onset folds: broad rounded crests and a narrow cusp at the valley (profile exponent), the fold's
//      occlusion darkening the valley, and the dry crests' lifting corneocytes paler (both carried by the cavity map: the colour of the line
//      is the film's, not a paint).
//   5. THE FOLDS THE PURSED LIP MAKES, KEPT AS CREASES (c7 iteration 23, LIP_PRINT_VERSION 2). Iteration 20 stopped at the onset: one even
//      ripple at ~1.2 mm everywhere (the c6 it3 critic: '~40 even stripes, one pitch for everyone'). A real print is a HIERARCHY: a few deep
//      sulci with plateaus between, shallower furrows between those, a fine crackle on the plateaus. The lip is not only at rest: it is
//      pursed and rounded many times a day (speech, the pucker: the intercommissural width falls by roughly a third, as recalled), so its
//      film has been compressed far past onset, and a stiff film on a soft substrate does not keep its onset wrinkles there: past a nominal
//      strain of ~0.2 every second valley deepens and the crests between flatten (PERIOD DOUBLING, Brau et al. 2011, Nature Physics 7:56,
//      'Multiple-length-scale elastic instability mimics parametric resonance of nonlinear oscillators'; the energy localising into folds,
//      Pocivavsek et al. 2008, Science 320:912), and the doubled state, compressed further, doubles again. The folds crease the corneum
//      where they form, and at rest the lip's own tone closes those creases first. So:
//      (a) the pursed lip's strain: the rest compression field's shape (the fibres, the convergence to the corners, the roll's tension, the
//          laxity's excess epithelium) at the pucker's magnitude LIP_FILM.purse (literature-scale, not fitted), the concentration taken on
//          the true (logarithmic) strain so a strain never reaches 1: eps_p = 1 - (1 - purse)^(e1 / tone);
//      (b) the cascade's thresholds eps_k = 1 - (1 - eps1)^k (eps1 the doubling strain; each folded state taken as a wrinkle of twice the
//          period under the strain left: an assumption of self-similarity, said plainly), k = 1 .. levels;
//      (c) each level k a Swift-Hohenberg field at half the previous wavenumber, its control from eps_p / eps_k, PHASE-LOCKED to the level
//          below by the parametric (2:1) coupling beta psi_(k-1) psi_k (Brau's mechanism), so its minima fall on every second minimum of the
//          level below: the deep folds sit on the onset valleys, never between them;
//      (d) at rest the creases are hinges: the tone's compression e1 closes them before it buckles the plateau between (a fold localises,
//          its neighbours' wrinkles decay: Pocivavsek 2008). Their share a1 = how far the folding went here (the doubled field's saturated
//          amplitude at the pucker's control, sqrt(r1 / r0)), split between the levels as the pucker's excess strain was (level k its span
//          (min(eps_p, eps_(k+1)) - eps_k)+ / (eps_p - eps1)); the ripple keeps 1 - a1. A level's crease, a V of width w = fold.w x lambda (the onset
//          valley it formed in) every 2^k lambda, takes its share as excess length: depth d = sqrt(((L + w) / 2)^2 - (w / 2)^2), L = share x
//          e1 x 2^k lambda. The ripple's amplitude comes from its share (A = h sqrt(share e1 / eps_c - 1)).
//      Outcome, not chosen: where the lip is pursed little (the middle, near the roll) the ripple stays; toward the corners (the compression
//      concentrated) the folds go deeper and further apart; an older, laxer lip holds more strain, so deeper sulci. purse 0 is the physics of
//      a lip never pursed: exactly iteration 20's ripple.
// Literature values, said plainly (no fit to a render): the SC modulus 12 MPa wet .. 400 MPa dry (Wu, Van Vliet & Dauskardt 2006: ~10-20 MPa
// at 100 % RH, ~0.4-1 GPa at 25-45 %), the substrate 50 kPa (the papillary layer at small strain, 30-100 kPa), the vermilion's SC 14 um
// (thinner than the cheek's 15-20 um; few cell layers), the orbicularis' resting shortening 5 %. With these the dry vermilion's wavelength is
// ~1.2 mm, inside the photographs' 1-1.5 mm (the spacing iterations 2-4 measured; it was a parameter there, it is an outcome here).
//
//   const LP = lipPrint(lips, st, zg)   // lips: bake.js lipsInMm(A, lines); st: features.js tissueState; zg: lipZGrid(...) or null
//   LP.at(x, y) -> null | { s (-1 valley .. 1 crest), A (mm, the ripple's), d (mm to the valley's floor), dry (0..1), c (mm: the creases'
//   depth here), h (mm: the relief, ripple - creases) }; LP.relief(s, A) the ripple's section alone; LP.report

export const LIP_FILM = {
  hSC: 0.014, Edry: 400, Ewet: 12, Es: 0.05, Lh: 1.8, Lk: 1.2,
  tone: 0.05, laxTone: 0.8, conv: 2.5, convN: 0.6, roll: 0.7, rollW: 0.8,
  // bulge: the tubercle's own stretch (its slope along the fibre over its 4 mm form, from the chart's front surface). OFF (0): on L14 (node,
  // iteration 20) it fired where the front-facing surface ENDS (the lower lip's in-turn at the wet line, two dead patches at x = +-12 mm),
  // not on the tubercle; it needs the lip's solved surface with its edge handled (NOSEMOUTH / face9's lips). 1 = the A/B, node only.
  bulge: 0,
  dry0: 0.3, dryAge: 0.5,
  het: { sigma: 0.5, corr: 1.2 },   // the film is not uniform: the SC's hydration (so its modulus) is patchy at the mm scale (capacitance imaging of the
                                    // lips and skin, as recalled): ln Ef + sigma xi, xi a unit Gaussian field of correlation length corr mm, the person's own
  sh: { r0: 0.3, gamma: 1.2, dt: 0.5, steps: 360, n: [256, 128], qClamp: [0.75, 1.33] },
  profile: 2.5, occ: 0.14, Wo: 0.2, flake: 0.06, Aref: 0.08,
  // (5) the pucker's shortening along the fibres (the intercommissural width ~50 -> ~33 mm in lip rounding, as recalled: ~0.35), the
  // doubling strain eps1 (Brau et al. 2011: ~0.2 nominal; 0.18), the levels of the cascade (2^3 lambda ~ 8-10 mm: the lip's own height
  // bounds a fold's spacing), the parametric coupling (the solver's: it locks the phase, ~r0), a crease's width in onset wavelengths (the
  // onset valley's own: a quarter period), the sharpness of a level's minimum in the product that places the creases
  purse: 0.35, fold: { eps1: 0.18, levels: 3, beta: -0.3, w: 0.25, pk: 2 },
};
export const LIP_PRINT_VERSION = 2;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- FFT (radix 2, in place)
function fftPlan(n) {
  const rev = new Uint32Array(n), lg = Math.round(Math.log2(n)); if (1 << lg !== n) throw new Error('lips: fft size ' + n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < lg; b++) r |= ((i >> b) & 1) << (lg - 1 - b); rev[i] = r; }
  const cs = new Float64Array(n / 2), sn = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = Math.sin(2 * Math.PI * i / n); }
  return { n, rev, cs, sn };
}
function fft1(P, re, im, inv) {
  const { n, rev, cs, sn } = P;
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) { const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) for (let k = 0; k < half; k++) { const c = cs[k * step], s = inv ? -sn[k * step] : sn[k * step], a = i + k, b = a + half;
      const tr = re[b] * c + im[b] * s, ti = im[b] * c - re[b] * s; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; } }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function fft2(PX, PY, re, im, NX, NY, inv, tr, ti) {
  for (let j = 0; j < NY; j++) { const o = j * NX; for (let i = 0; i < NX; i++) { tr[i] = re[o + i]; ti[i] = im[o + i]; } fft1(PX, tr, ti, inv); for (let i = 0; i < NX; i++) { re[o + i] = tr[i]; im[o + i] = ti[i]; } }
  for (let i = 0; i < NX; i++) { for (let j = 0; j < NY; j++) { tr[j] = re[j * NX + i]; ti[j] = im[j * NX + i]; } fft1(PY, tr, ti, inv); for (let j = 0; j < NY; j++) { re[j * NX + i] = tr[j]; im[j * NX + i] = ti[j]; } }
}

// ---------------------------------------------------------------- the lip's own surface (front depth) on a grid
// zg = { x0, y0, d, nx, ny, z (Float32Array, NaN where no vermilion face) } from the chart's triangles (bind mm, A frame): the front-most z
export function lipZGrid(lips, tris, X, on, d = 0.25) {
  if (!lips) return null;
  const { yAt, halfMm, cx } = lips; let yB = 1e9, yT = -1e9; for (let ax = 0; ax <= halfMm; ax += 0.5) { yB = Math.min(yB, yAt(ax, 3)); yT = Math.max(yT, yAt(ax, 2)); }
  const x0 = cx - halfMm - 2, y0 = yB - 2, nx = Math.ceil((2 * halfMm + 4) / d), ny = Math.ceil((yT - yB + 4) / d), z = new Float32Array(nx * ny).fill(NaN);
  const zMin = lips.zFrontMm - 12;
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; if (on && !(on[a] && on[b] && on[c])) continue;
    const P = [a, b, c].map(v => [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]);
    if (P.every(p => p[2] < zMin)) continue;
    const xs = P.map(p => (p[0] - x0) / d), ys = P.map(p => (p[1] - y0) / d);
    const i0 = Math.max(0, Math.floor(Math.min(...xs))), i1 = Math.min(nx - 1, Math.ceil(Math.max(...xs))), j0 = Math.max(0, Math.floor(Math.min(...ys))), j1 = Math.min(ny - 1, Math.ceil(Math.max(...ys)));
    if (i0 > i1 || j0 > j1) continue;
    const den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]); if (Math.abs(den) < 1e-9) continue;
    // front-facing only (the inner, mucosal turn of the lip behind the wet line is not the surface the camera sees)
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    const nz = e1[0] * e2[1] - e1[1] * e2[0], nl = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], nz) || 1; if (Math.abs(nz) / nl < 0.2) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = i + 0.5, y = j + 0.5;
      const w0 = ((ys[1] - ys[2]) * (x - xs[2]) + (xs[2] - xs[1]) * (y - ys[2])) / den, w1 = ((ys[2] - ys[0]) * (x - xs[2]) + (xs[0] - xs[2]) * (y - ys[2])) / den, w2 = 1 - w0 - w1;
      if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const zz = P[0][2] * w0 + P[1][2] * w1 + P[2][2] * w2, k = j * nx + i; if (!(z[k] >= zz)) z[k] = zz; } }
  return { x0, y0, d, nx, ny, z };
}
const zAt = (zg, x, y) => { if (!zg) return NaN; const fx = (x - zg.x0) / zg.d - 0.5, fy = (y - zg.y0) / zg.d - 0.5, i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= zg.nx - 1 || j >= zg.ny - 1) return NaN; const a = fx - i, b = fy - j, k = j * zg.nx + i, Z = zg.z;
  const v = [Z[k], Z[k + 1], Z[k + zg.nx], Z[k + zg.nx + 1]], w = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b]; let s = 0, ws = 0;
  for (let q = 0; q < 4; q++) if (Number.isFinite(v[q])) { s += v[q] * w[q]; ws += w[q]; } return ws > 0.3 ? s / ws : NaN; };

// normalized Gaussian blur of a masked field (NaN = no data) on an n1 x n2 grid
function blurMasked(a, n1, n2, sig) {
  const r = Math.ceil(sig * 2.5), w = []; for (let i = -r; i <= r; i++) w.push(Math.exp(-0.5 * (i / sig) ** 2));
  const pass = (src, wsrc, horiz) => { const o = new Float64Array(n1 * n2), ow = new Float64Array(n1 * n2);
    for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) { let s = 0, ws = 0; for (let q = -r; q <= r; q++) { const ii = horiz ? i + q : i, jj = horiz ? j : j + q; if (ii < 0 || jj < 0 || ii >= n1 || jj >= n2) continue; const k = jj * n1 + ii; s += src[k] * w[q + r]; ws += wsrc[k] * w[q + r]; } o[j * n1 + i] = s; ow[j * n1 + i] = ws; }
    return [o, ow]; };
  const v0 = new Float64Array(n1 * n2), w0 = new Float64Array(n1 * n2); for (let k = 0; k < n1 * n2; k++) if (Number.isFinite(a[k])) { v0[k] = a[k]; w0[k] = 1; }
  const [v1, w1] = pass(v0, w0, true), [v2, w2] = pass(v1, w1, false), o = new Float64Array(n1 * n2);
  for (let k = 0; k < n1 * n2; k++) o[k] = w2[k] > 1e-6 ? v2[k] / w2[k] : NaN; return o;
}

// ---------------------------------------------------------------- the person's lip print
export function lipPrint(lips, st, zg = null, o = {}) {
  if (!lips) return null;
  const t0 = Date.now(), F = { ...LIP_FILM, ...(o.film || {}) }, SH = { ...LIP_FILM.sh, ...(o.sh || {}) }, [NX, NY] = SH.n;
  const { yAt, halfMm, cx } = lips; let yB = 1e9, yT = -1e9; for (let ax = 0; ax <= halfMm; ax += 0.25) { yB = Math.min(yB, yAt(ax, 3)); yT = Math.max(yT, yAt(ax, 2)); }
  const Wmm = 2 * halfMm + 3, Hmm = yT - yB + 3, D = Math.max(Wmm / NX, Hmm / NY), x0 = cx - NX * D / 2, y0 = (yT + yB) / 2 - NY * D / 2, N = NX * NY;
  const lax = st?.lax ?? 0, ageK = st?.ageK ?? 0, dryP = clamp(F.dry0 + F.dryAge * ageK), Hw = 1 - 0.45 * dryP;
  const film = (H, xi = 0) => { const Ef = Math.exp((1 - H) * Math.log(F.Edry) + H * Math.log(F.Ewet) + F.het.sigma * xi), ratio = Ef / (3 * F.Es); return { Ef, lam: 2 * Math.PI * F.hSC * Math.cbrt(ratio), epsC: 0.25 * Math.pow(1 / ratio, 2 / 3) }; };
  const hc = [yAt(0, 2) - yAt(0, 1), yAt(0, 1) - yAt(0, 3)];   // the upper and the lower lip's heights at the midline
  // the reference wavelength: the lower lip's middle, half-way up (the person's dry vermilion); the phase field's unit is 1 / Q
  const ref = film(Hw * Math.exp(-0.5 * hc[1] / F.Lh)), lam0 = ref.lam, Q = 2 * Math.PI / lam0, Dn = Q * D;
  const epsT = F.tone * (1 + F.laxTone * lax);
  // per cell: the fibre frame, the compression, the film
  const inV = new Uint8Array(N), R = new Float64Array(N), Gm = new Float64Array(N), TX = new Float64Array(N), TY = new Float64Array(N), QQ = new Float64Array(N).fill(1);
  const AM = new Float32Array(N), HY = new Float32Array(N), Q1 = new Float32Array(N), FX = new Float64Array(N), FY = new Float64Array(N), E1 = new Float64Array(N), E2 = new Float64Array(N);
  const B = new Float64Array(N).fill(NaN);
  // the person's seed (a lip print is individual) and the film's quenched heterogeneity (its own stream)
  let seed = 2166136261; for (const ch of String(st?.name || 'x') + '|lipPrint') seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0; seed = seed || 1;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const XI = new Float64Array(N); { const wn = new Float64Array(N); for (let k = 0; k < N; k++) wn[k] = gauss(); const b = blurMasked(wn, NX, NY, F.het.corr / D); let m = 0, v = 0; for (let k = 0; k < N; k++) m += b[k]; m /= N; for (let k = 0; k < N; k++) v += (b[k] - m) ** 2; v = Math.sqrt(v / N) || 1; for (let k = 0; k < N; k++) XI[k] = (b[k] - m) / v; }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i, x = x0 + (i + 0.5) * D, y = y0 + (j + 0.5) * D, xl = x - cx, ax = Math.abs(xl), sg = xl >= 0 ? 1 : -1;
    R[k] = -0.6; if (ax > halfMm) continue;
    const yM = yAt(ax, 1), upper = y >= yM, yE = yAt(ax, upper ? 2 : 3), hl = Math.abs(yE - yM); if (hl < 0.2) continue;
    const dw = upper ? y - yM : yM - y; if (dw < 0 || dw > hl) continue;
    inV[k] = 1; const v = dw / hl, dd = 0.05, yv = a => { const m = yAt(a, 1); return m + v * (yAt(a, upper ? 2 : 3) - m); };
    const slope = (yv(Math.min(halfMm, ax + dd)) - yv(Math.max(0, ax - dd))) / (Math.min(halfMm, ax + dd) - Math.max(0, ax - dd)) * sg, fl = Math.hypot(1, slope);
    FX[k] = 1 / fl; FY[k] = slope / fl;
    const h0 = hc[upper ? 0 : 1], conv = clamp(h0 / hl, 1, F.conv), rollT = 1 - F.roll * sst(hl - F.rollW, hl, dw);
    E1[k] = epsT * conv * rollT; E2[k] = epsT * F.convN * clamp(1 - hl / h0) * rollT;
    if (zg && F.bulge) B[k] = zAt(zg, x, y);
    const H = Hw * Math.exp(-dw / F.Lh); HY[k] = H; }
  // the tubercle's (and any bulge's) stretch along the fibre: the surface's own slope along the fibre over its 4 mm form
  let bulgeMax = 0;
  if (zg && F.bulge) { const Bs = blurMasked(B, NX, NY, 4 / D), bb = new Float64Array(N).fill(NaN); for (let k = 0; k < N; k++) if (inV[k] && Number.isFinite(B[k]) && Number.isFinite(Bs[k])) bb[k] = B[k] - Bs[k];
    const eb = new Float64Array(N).fill(NaN);
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) { const k = j * NX + i; if (!Number.isFinite(bb[k])) continue;
      const gx = Number.isFinite(bb[k + 1]) && Number.isFinite(bb[k - 1]) ? (bb[k + 1] - bb[k - 1]) / (2 * D) : 0, gy = Number.isFinite(bb[k + NX]) && Number.isFinite(bb[k - NX]) ? (bb[k + NX] - bb[k - NX]) / (2 * D) : 0;
      const gf = gx * FX[k] + gy * FY[k]; eb[k] = 0.5 * gf * gf; }
    const ebs = blurMasked(eb, NX, NY, 1.5 / D);
    for (let k = 0; k < N; k++) if (inV[k] && Number.isFinite(ebs[k])) { const e = F.bulge * ebs[k]; bulgeMax = Math.max(bulgeMax, e); E1[k] -= e; } }
  // (5) the pucker's strain and the cascade's thresholds; the rest compression's shares (the ripple's and each level's)
  const FD = { ...LIP_FILM.fold, ...(F.fold || {}) }, NL = Math.max(0, Math.round(FD.levels));
  const epsK = [0]; for (let l = 1; l <= NL + 1; l++) epsK.push(1 - Math.pow(1 - FD.eps1, l));
  const EP = new Float64Array(N), SH0 = new Float64Array(N).fill(1), SHK = Array.from({ length: NL + 1 }, () => new Float64Array(N)), LAM = new Float64Array(N);
  let nUni = 0, nBi = 0, nSub = 0, nIn = 0, aMax = 0, epMax = 0;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i; if (!inV[k]) continue; nIn++;
    const ef = E1[k], en = E2[k], along = ef >= en, e1 = Math.max(ef, en), e2 = Math.min(ef, en), fm = film(HY[k], XI[k]);
    // the furrows run across the principal compression: t = the compression direction rotated 90 degrees
    const cxd = along ? FX[k] : -FY[k], cyd = along ? FY[k] : FX[k]; TX[k] = -cyd; TY[k] = cxd;
    const an = e1 > 0 ? clamp((e1 - Math.max(0, e2)) / (e1 + Math.max(0, e2))) : 0; Gm[k] = SH.gamma * an; if (an > 0.6) nUni++; else nBi++;
    const ratio = e1 / fm.epsC; R[k] = ratio > 0 ? SH.r0 * Math.tanh(0.5 * Math.log(ratio)) : -SH.r0; if (ratio < 1) nSub++;
    QQ[k] = clamp(lam0 / fm.lam, SH.qClamp[0], SH.qClamp[1]); Q1[k] = 2 * Math.PI / fm.lam; LAM[k] = 2 * Math.PI / (QQ[k] * Q);
    const xl = x0 + (i + 0.5) * D - cx, ax = Math.abs(xl), yM = yAt(ax, 1), y = y0 + (j + 0.5) * D, dw = Math.abs(y - yM);
    // the pucker's strain here, and how the rest tone's compression is shared between the ripple and the levels' creases (5d)
    const ep = 1 - Math.pow(1 - (F.purse || 0), Math.max(0, e1) / F.tone); EP[k] = ep; epMax = Math.max(epMax, ep);
    // the creases, where they formed, are hinges: the rest compression closes them before it buckles the plateau between (a fold localises
    // and its neighbours' wrinkles decay: Pocivavsek 2008). Their share = how far the folding went here, the doubled field's saturated
    // amplitude at the pucker's control (sqrt(r1 / r0), the Swift-Hohenberg outcome); the ripple keeps the rest; the creases' share is
    // split between the levels as the pucker's excess strain was (each level's span of it)
    if (ep > epsK[1] && NL > 0) { const a1 = Math.sqrt(Math.max(0, Math.tanh(0.5 * Math.log(ep / epsK[1])))); SH0[k] = 1 - a1;
      for (let l = 1; l <= NL; l++) SHK[l][k] = a1 * Math.max(0, (l < NL ? Math.min(ep, epsK[l + 1]) : ep) - epsK[l]) / (ep - epsK[1]); }
    AM[k] = F.hSC * sst(0, F.Lk, dw) * Math.sqrt(Math.max(0, SH0[k] * ratio - 1)); aMax = Math.max(aMax, AM[k]); }
  // ---- the phase fields: d psi / dt = r psi - (q^2 + lap)^2 psi - psi^3 + gamma (t . grad)^2 psi [+ beta psi_below psi], pseudo-spectral,
  //      semi-implicit about the level's reference wavenumber with a linear stabilizer for the explicit operators (the anisotropy and the
  //      local wavenumber's departure from the reference). Level 0 is the onset (iteration 20's field, unchanged); level l runs at 2^-l of it.
  const PX = fftPlan(NX), PY = fftPlan(NY), tr = new Float64Array(Math.max(NX, NY)), ti = new Float64Array(Math.max(NX, NY));
  const K2 = new Float64Array(N); for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const kx = 2 * Math.PI * (i < NX / 2 ? i : i - NX) / (NX * Dn), ky = 2 * Math.PI * (j < NY / 2 ? j : j - NY) / (NY * Dn); K2[j * NX + i] = kx * kx + ky * ky; }
  const dt = SH.dt, id2 = 1 / (Dn * Dn), pr = new Float64Array(N), pi = new Float64Array(N), nr = new Float64Array(N), ni = new Float64Array(N);
  const solve = (Rl, qRef, QL, below, beta) => {
    const q2r = qRef * qRef; let Smax = 0; for (let k = 0; k < N; k++) Smax = Math.max(Smax, Gm[k] + 2 * Math.abs(QL[k] * QL[k] - q2r)); const S = 0.5 * Smax + 0.5;
    const den = new Float64Array(N); for (let k = 0; k < N; k++) den[k] = 1 + dt * ((q2r - K2[k]) ** 2 + S * K2[k]);
    const psi = new Float64Array(N); for (let k = 0; k < N; k++) psi[k] = inV[k] ? 0.05 * (rnd() - 0.5) : 0;
    pr.set(psi); pi.fill(0); fft2(PX, PY, pr, pi, NX, NY, false, tr, ti);
    const at = (i, j) => psi[((j + NY) % NY) * NX + ((i + NX) % NX)];
    for (let step = 0; step < SH.steps; step++) {
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i, p = psi[k];
        const pxx = (at(i + 1, j) - 2 * p + at(i - 1, j)) * id2, pyy = (at(i, j + 1) - 2 * p + at(i, j - 1)) * id2, pxy = (at(i + 1, j + 1) - at(i + 1, j - 1) - at(i - 1, j + 1) + at(i - 1, j - 1)) * 0.25 * id2;
        const q2 = QL[k] * QL[k], lap = pxx + pyy, tt = TX[k] * TX[k] * pxx + 2 * TX[k] * TY[k] * pxy + TY[k] * TY[k] * pyy;
        nr[k] = Rl[k] * p - p * p * p + Gm[k] * tt - (q2 - q2r) * (2 * lap + (q2 + q2r) * p) + (below ? beta * below[k] * p : 0); ni[k] = 0; }
      fft2(PX, PY, nr, ni, NX, NY, false, tr, ti);
      for (let k = 0; k < N; k++) { const ex = 1 + dt * S * K2[k]; pr[k] = (pr[k] * ex + dt * nr[k]) / den[k]; pi[k] = (pi[k] * ex + dt * ni[k]) / den[k]; }
      nr.set(pr); ni.set(pi); fft2(PX, PY, nr, ni, NX, NY, true, tr, ti); psi.set(nr);
    }
    return { psi, S };
  };
  const L0 = solve(R, 1, QQ, null, 0), psi = L0.psi, S = L0.S;
  // ---- the outcome: s in -1..1 (the saturated stripe's amplitude sqrt(4 r0 / 3)), the valley's distance from the local phase
  const sat = Math.sqrt(4 * SH.r0 / 3), Sg = new Float32Array(N); let nPat = 0;
  for (let k = 0; k < N; k++) { Sg[k] = inV[k] ? clamp(psi[k] / sat, -1, 1) : 0; if (inV[k] && Math.abs(Sg[k]) > 0.3) nPat++; }
  // ---- (5c) the cascade: level l where the pucker passed eps_l, phase-locked to the level below; (5d) its crease depth per cell
  const SL = [Sg], DK = [null], levels = []; let below = psi;
  for (let l = 1; l <= NL; l++) {
    let any = 0; for (let k = 0; k < N; k++) if (inV[k] && SHK[l][k] > 0) { any = 1; break; }
    if (!any) break;
    const Rl = new Float64Array(N).fill(-0.6), QL = new Float64Array(N), sc = Math.pow(2, -l);
    for (let k = 0; k < N; k++) { QL[k] = QQ[k] * sc; if (inV[k]) Rl[k] = EP[k] > 0 ? SH.r0 * Math.tanh(0.5 * Math.log(EP[k] / epsK[l])) : -SH.r0; }
    const Ll = solve(Rl, sc, QL, below, FD.beta), Sl = new Float32Array(N), Dl = new Float32Array(N); below = Ll.psi;
    let nOn = 0, dMax = 0;
    for (let k = 0; k < N; k++) { if (!inV[k]) continue; Sl[k] = clamp(Ll.psi[k] / sat, -1, 1);
      const lam = LAM[k], w = FD.w * lam, Lx = SHK[l][k] * Math.max(0, Math.max(E1[k], E2[k])) * Math.pow(2, l) * lam;
      const xl = x0 + ((k % NX) + 0.5) * D - cx, yM = yAt(Math.abs(xl), 1), dw = Math.abs(y0 + (Math.floor(k / NX) + 0.5) * D - yM);
      Dl[k] = Lx > 0 ? sst(0, F.Lk, dw) * Math.sqrt(Math.max(0, ((Lx + w) / 2) ** 2 - (w / 2) ** 2)) : 0; dMax = Math.max(dMax, Dl[k]); if (Dl[k] > 0.01 && Math.abs(Sl[k]) > 0.3) nOn++; }
    SL.push(Sl); DK.push(Dl); levels.push({ level: l, epsMin: +epsK[l].toFixed(3), spacingMm: +(Math.pow(2, l) * lam0).toFixed(2), active: +(nOn / Math.max(1, nIn)).toFixed(3), creaseMaxMm: +dMax.toFixed(3) });
  }
  // the creases' depth at a point: each level's own depth on its minima, those minima on every second minimum of the level below (the
  // product), sharpened to the crease's width by the onset field (its valley's power from fold.w: half depth at a quarter period across)
  const P0 = Math.log(0.5) / (2 * Math.log(Math.cos(Math.PI * FD.w / 2)));
  const creaseOf = (s0, sl, dl) => { let c = 0, prod = Math.pow(clamp((1 - s0) / 2), P0); for (let l = 1; l < sl.length; l++) { prod *= Math.pow(clamp((1 - sl[l]) / 2), FD.pk); c += dl[l] * prod; } return c; };
  const C = new Float32Array(N); let cMax = 0;
  for (let k = 0; k < N; k++) if (inV[k] && SL.length > 1) { const sl = SL.map(a => a[k]), dl = DK.map(a => a ? a[k] : 0); C[k] = creaseOf(Sg[k], sl, dl); cMax = Math.max(cMax, C[k]); }
  const samp = (A, x, y) => { const fx = (x - x0) / D - 0.5, fy = (y - y0) / D - 0.5, i = Math.max(0, Math.min(NX - 2, Math.floor(fx))), j = Math.max(0, Math.min(NY - 2, Math.floor(fy))), a = clamp(fx - i), b = clamp(fy - j), k = j * NX + i;
    return (A[k] * (1 - a) + A[k + 1] * a) * (1 - b) + (A[k + NX] * (1 - a) + A[k + NX + 1] * a) * b; };
  const inside = (x, y) => { const i = Math.floor((x - x0) / D), j = Math.floor((y - y0) / D); return i >= 0 && j >= 0 && i < NX && j < NY; };
  // the profile's mean over a period of s = cos(theta) (so the relief has no offset over a furrowed field)
  let gMean = 0; for (let q = 0; q < 256; q++) gMean += 1 - 2 * Math.pow((1 - Math.cos(Math.PI * (q + 0.5) / 256)) / 2, F.profile); gMean /= 256;
  const relief = (s, A) => A * (1 - 2 * Math.pow((1 - s) / 2, F.profile) - gMean);
  // describe (no gate): the furrows a horizontal line across the lower lip's middle meets (local minima of the relief deeper than 0.05 mm)
  const furrows = []; for (const v of [0.5]) { let n = 0, prev = 0, prev2 = 0;
    for (let i = 0; i < NX; i++) { const x = x0 + (i + 0.5) * D, ax = Math.abs(x - cx); if (ax > halfMm * 0.95) { prev2 = prev = 0; continue; }
      const yM = yAt(ax, 1), y = yM - v * Math.abs(yAt(ax, 3) - yM), jj = Math.floor((y - y0) / D); if (jj < 0 || jj >= NY) continue; const k = jj * NX + i;
      const hh = inV[k] ? relief(Sg[k], AM[k]) - C[k] : 0; if (i > 1 && prev < prev2 && prev < hh && prev < -0.05) n++; prev2 = prev; prev = hh; }
    furrows.push(n); }
  const report = { version: LIP_PRINT_VERSION, grid: [NX, NY], cellMm: +D.toFixed(4), lam0Mm: +lam0.toFixed(3), epsTone: +epsT.toFixed(4), dryness: +dryP.toFixed(3),
    steps: SH.steps, S: +S.toFixed(3), cells: nIn, patterned: +(nPat / Math.max(1, nIn)).toFixed(3), uniaxial: +(nUni / Math.max(1, nIn)).toFixed(3), biaxial: +(nBi / Math.max(1, nIn)).toFixed(3),
    subcritical: +(nSub / Math.max(1, nIn)).toFixed(3), Amax: +aMax.toFixed(4), bulgeMax: +bulgeMax.toFixed(4), z: !!zg,
    purse: F.purse, epsPuckerMax: +epMax.toFixed(3), levels, creaseMaxMm: +cMax.toFixed(3), lowerLipFurrows: furrows[0], ms: 0 };
  report.ms = Date.now() - t0;
  return {
    report, grid: { x0, y0, D, NX, NY, s: Sg, A: AM, H: HY, inV, R: Float32Array.from(R), G: Float32Array.from(Gm), Q: Q1, TX: Float32Array.from(TX), TY: Float32Array.from(TY), C, SL, DK },
    at(x, y) { if (!inside(x, y)) return null; const s = clamp(samp(Sg, x, y), -1, 1), A = Math.max(0, samp(AM, x, y)), H = clamp(samp(HY, x, y)), q = Math.max(1, samp(Q1, x, y));
      const c = SL.length > 1 ? creaseOf(s, SL.map(a => clamp(samp(a, x, y), -1, 1)), DK.map(a => a ? Math.max(0, samp(a, x, y)) : 0)) : 0;
      return { s, A, d: (Math.PI - Math.acos(s)) / q, dry: 1 - H, c, h: relief(s, A) - c }; },
    // the ripple's section (a buckled film far past onset: broad crests, a narrow cusp at the valley; mean ~0 over a period); the creases are at()'s c
    relief,
    film: F,
  };
}
