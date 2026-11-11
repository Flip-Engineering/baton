// POLARISCOPE, the reference (Oct 2026; OBJECTIVE ep.1 AT REST): photoelasticity computed, not painted, in plain JS so node can check it
// against closed-form physics (web/labs/objective/polariscope_test.mjs). polariscope.js runs the same maths per pixel in GLSL; the GL
// still is checked against this file on a farm bench still. Units: millimetres for geometry, Pa for stress, metres for wavelength.
//
//   body = dropBody({ sigmaS: -560e6 })          // the drop as an SDF (head sphere + swept tapered tail, smooth union) with its stress field
//   const r = trace(ray, body, { lambdas, kind: 'circular', field: 'dark', analyser: 1, env })
//   r.I (band radiance at the camera), r.order (scalar retardation / 2 pi along the path, valid where the axes do not turn),
//   r.exit (direction the ray leaves toward the source), r.T (Fresnel transmission), r.tir (total internal reflections), r.depol
//
// Optics along one ray (traced from the camera back toward the source, as a renderer does):
//   - march the body's SDF; at each surface Snell at n with unpolarised Fresnel; total internal reflection when Snell has no root;
//   - inside, take the stress tensor at the segment's midpoint, project it on the plane normal to the ray, its secondary principal
//     difference gives a linear retarder: d(delta) = (2 pi / lambda) C (s1' - s2') ds at the in-plane angle phi;
//   - multiply the 2x2 complex Jones matrices in the LIGHT's order (the last segment the light meets is the first one traced), in a
//     transverse frame (e1, e2) right-handed about the light's direction (-d: for a ray along -z, e1 = x and e2 = y, so angles are the
//     lab's as the camera sees them), carried along the ray by parallel transport, so the turning of axes along a bent 3D path is kept;
//   - the polariscope train: polariser at 0, quarter-wave at +45 deg, specimen, quarter-wave at -45 deg, analyser at 90 deg (dark field);
//     analyser out = unpolarised detection (Jones matrices of retarders are unitary, so no stress term survives);
//   - fractured glass behind a crack front scatters and depolarises: its light passes a crossed analyser at half intensity.
// Nothing here draws: it is the physics the shader must agree with.

export const SODIUM_D = 589.3e-9;          // m, the sodium D doublet's mean (589.0 / 589.6 nm)
export const C_SODALIME = 2.7e-12;         // Pa^-1, stress-optic coefficient of soda-lime glass (Aben's integrated photoelasticity uses 2.7e-12)
export const N_GLASS = 1.52, N_WATER = 1.333;

// ---------------------------------------------------------------- small vector maths (arrays of 3)
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const madd = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// ---------------------------------------------------------------- Jones calculus: a 2x2 complex matrix as 8 numbers [ar ai br bi cr ci dr di]
export const J = {
  I: () => [1, 0, 0, 0, 0, 0, 1, 0],
  mul(A, B) {   // A * B
    const m = (xr, xi, yr, yi) => [xr * yr - xi * yi, xr * yi + xi * yr];
    const [a, b] = [m(A[0], A[1], B[0], B[1]), m(A[2], A[3], B[4], B[5])], [c, d] = [m(A[0], A[1], B[2], B[3]), m(A[2], A[3], B[6], B[7])];
    const [e, f] = [m(A[4], A[5], B[0], B[1]), m(A[6], A[7], B[4], B[5])], [g, h] = [m(A[4], A[5], B[2], B[3]), m(A[6], A[7], B[6], B[7])];
    return [a[0] + b[0], a[1] + b[1], c[0] + d[0], c[1] + d[1], e[0] + f[0], e[1] + f[1], g[0] + h[0], g[1] + h[1]];
  },
  // a linear retarder of retardance delta (rad) with its slow axis at phi (rad): R(phi) diag(e^{-i d/2}, e^{i d/2}) R(-phi)
  retarder(delta, phi) { const c = Math.cos(delta / 2), s = Math.sin(delta / 2), c2 = Math.cos(2 * phi), s2 = Math.sin(2 * phi);
    return [c, -s * c2, 0, -s * s2, 0, -s * s2, c, s * c2]; },
  polarizer(th) { const c = Math.cos(th), s = Math.sin(th); return [c * c, 0, c * s, 0, c * s, 0, s * s, 0]; },
  qwp: th => J.retarder(Math.PI / 2, th),
  rot(th) { const c = Math.cos(th), s = Math.sin(th); return [c, 0, -s, 0, s, 0, c, 0]; },
  apply(M, e) {   // e = [xr, xi, yr, yi]
    return [M[0] * e[0] - M[1] * e[1] + M[2] * e[2] - M[3] * e[3], M[0] * e[1] + M[1] * e[0] + M[2] * e[3] + M[3] * e[2],
      M[4] * e[0] - M[5] * e[1] + M[6] * e[2] - M[7] * e[3], M[4] * e[1] + M[5] * e[0] + M[6] * e[3] + M[7] * e[2]]; },
  power: e => e[0] * e[0] + e[1] * e[1] + e[2] * e[2] + e[3] * e[3],
};

// the polariscope trains: intensity at the detector for a specimen Jones matrix M (in the transverse frame), unit input power.
// beta: the angle of the source-side elements in the frame the ray carried to the source end (0 for a straight path).
export function trainIntensity(M, { kind = 'circular', field = 'dark', analyser = 1, theta = 0, beta = 0 } = {}) {
  let E, after;
  if (kind === 'circular') {
    E = J.apply(J.qwp(Math.PI / 4 + beta), [Math.cos(beta), 0, Math.sin(beta), 0]);   // polariser at 0 then a quarter-wave at +45 (source side)
    const out = J.apply(J.qwp(-Math.PI / 4), J.apply(M, E));                          // specimen, then the camera's quarter-wave at -45
    after = field === 'dark' ? J.apply(J.polarizer(Math.PI / 2), out) : J.apply(J.polarizer(0), out);
    const open = J.power(J.apply(M, E));
    return analyser * J.power(after) + (1 - analyser) * open;
  }
  // plane polariscope: polariser at theta, analyser crossed (dark) or parallel (light)
  E = [Math.cos(theta + beta), 0, Math.sin(theta + beta), 0];
  const out = J.apply(M, E);
  after = J.apply(J.polarizer(theta + (field === 'dark' ? Math.PI / 2 : 0)), out);
  return analyser * J.power(after) + (1 - analyser) * J.power(out);
}

// ---------------------------------------------------------------- the filter: Gaussian band, sampled by Gauss-Hermite (exact for the Gaussian weight)
const GH = { 1: [[0], [1.7724538509]], 3: [[-1.2247448714, 0, 1.2247448714], [0.2954089752, 1.1816359006, 0.2954089752]],
  5: [[-2.0201828705, -0.9585724646, 0, 0.9585724646, 2.0201828705], [0.0199532421, 0.3936193232, 0.9453087205, 0.3936193232, 0.0199532421]],
  7: [[-2.6519613568, -1.6735516288, -0.8162878829, 0, 0.8162878829, 1.6735516288, 2.6519613568], [0.0009717812, 0.0545155828, 0.4256072526, 0.8102646176, 0.4256072526, 0.0545155828, 0.0009717812]] };
export function bandSamples(l0 = SODIUM_D, fwhm = 10e-9, n = 5) {
  if (!GH[n] || fwhm <= 0) return [{ l: l0, w: 1 }];
  const sig = fwhm / (2 * Math.sqrt(2 * Math.LN2)), [x, w] = GH[n];
  return x.map((xi, i) => ({ l: l0 + Math.SQRT2 * sig * xi, w: w[i] / Math.sqrt(Math.PI) }));
}
// fringe visibility at order N in a Gaussian band (closed form): exp(-(pi N dl / l)^2 / (4 ln 2))
export const visibility = (N, l0 = SODIUM_D, fwhm = 10e-9) => Math.exp(-((Math.PI * N * fwhm / l0) ** 2) / (4 * Math.LN2));

// ---------------------------------------------------------------- stress fields (Pa), each returns a symmetric 3x3 as [xx, yy, zz, xy, yz, zx]
const S0 = () => [0, 0, 0, 0, 0, 0];
const outer = (a, k) => [k * a[0] * a[0], k * a[1] * a[1], k * a[2] * a[2], k * a[0] * a[1], k * a[1] * a[2], k * a[2] * a[0]];
const addS = (A, B) => A.map((x, i) => x + B[i]);
const scaleS = (A, k) => A.map(x => x * k);
export const stressAdd = addS, stressScale = scaleS;
// sphere of radius a with the residual field of a parabolic freeze profile: free surface sigma_r(a) = 0, the skin in compression sigma_s,
// the centre in tension -sigma_s:  sigma_r = sigma_s (r^2/a^2 - 1),  sigma_t = sigma_p = sigma_s (2 r^2/a^2 - 1)
export function sphereField(a, sigmaS, c = [0, 0, 0]) {
  return p => { const d = sub(p, c), r = len(d), q = (r * r) / (a * a), sr = sigmaS * (q - 1), st = sigmaS * (2 * q - 1);
    if (r < 1e-12) return [st, st, st, 0, 0, 0];
    const u = mul(d, 1 / r); return addS([st, st, st, 0, 0, 0], outer(u, sr - st)); };
}
// a slender cylinder of local radius R about an axis (unit t through point o): the parabolic-freeze cylinder field
//   sigma_z = sigma_s (2 rho^2/R^2 - 1), sigma_t = (sigma_s/2)(3 rho^2/R^2 - 1), sigma_rho = (sigma_s/2)(rho^2/R^2 - 1)
export function cylinderStress(rhoVec, t, R, sigmaS) {
  const rho = len(rhoVec), q = (rho * rho) / (R * R), sz = sigmaS * (2 * q - 1), st = sigmaS / 2 * (3 * q - 1), sr = sigmaS / 2 * (q - 1);
  let out = outer(t, sz);
  if (rho < 1e-9) { const e = Math.abs(t[0]) < 0.9 ? norm(cross(t, [1, 0, 0])) : norm(cross(t, [0, 1, 0])), f = cross(t, e); return addS(out, addS(outer(e, sr), outer(f, sr))); }
  const rh = mul(rhoVec, 1 / rho), th = cross(t, rh);
  return addS(out, addS(outer(rh, sr), outer(th, st)));
}
// diametral compression of a disc (Frocht; Timoshenko & Goodier): radius R, thickness h (mm), total load P (N) along y, plane stress in x-y
export function discField(R, h, P) {
  const k = 2 * P / (Math.PI * h) * 1e6;   // 2P / (pi h) in N/mm; times a length^-1 in mm -> MPa; * 1e6 -> Pa
  return p => { const x = p[0], y = p[1], D = 2 * R, r1 = x * x + (R - y) ** 2, r2 = x * x + (R + y) ** 2;
    const sx = -k * ((R - y) * x * x / (r1 * r1) + (R + y) * x * x / (r2 * r2) - 1 / D);
    const sy = -k * ((R - y) ** 3 / (r1 * r1) + (R + y) ** 3 / (r2 * r2) - 1 / D);
    const txy = k * ((R - y) ** 2 * x / (r1 * r1) - (R + y) ** 2 * x / (r2 * r2));
    return [sx, sy, 0, txy, 0, 0]; };
}
// the in-plane principal direction of the disc field (for the isoclinic test): angle of sigma_1 from +x
export function discPrincipal(field, p) { const s = field(p); return 0.5 * Math.atan2(2 * s[3], s[0] - s[1]); }

// projection of a stress tensor on the plane normal to the ray, in the transverse basis (e1, e2): secondary principal difference and angle
export function secondary(S, e1, e2) {
  const Se = v => [S[0] * v[0] + S[3] * v[1] + S[5] * v[2], S[3] * v[0] + S[1] * v[1] + S[4] * v[2], S[5] * v[0] + S[4] * v[1] + S[2] * v[2]];
  const a = dot(e1, Se(e1)), b = dot(e2, Se(e2)), c = dot(e1, Se(e2));
  return { diff: Math.sqrt((a - b) * (a - b) + 4 * c * c), phi: 0.5 * Math.atan2(2 * c, a - b) };
}

// ---------------------------------------------------------------- the drop's geometry: a head sphere and a swept, tapered tail (mm)
// The centreline runs from the head's centre up the neck (rising from the head's upper left) and curls up and out to the right; it is
// densified from these control points by Catmull-Rom. Arc length s is measured from the head's centre; the tail radius r(s) falls from the
// neck to about 0.3 mm (0.75 mm at the break, 30 mm from the head's centre); the whole drop is about 100 mm long ("about four inches").
export const DROP = {
  head: 6.0,                                         // mm: a 12 mm head (Aben et al. 2016: 5-15 mm)
  ctrl: [[0, 0, 0], [-2.2, 4.5, 0], [-3.6, 8.5, -0.3], [-3.4, 13, -0.6], [-1.2, 17.5, -0.8], [2.8, 21.5, -0.6], [8.0, 25.0, -0.2], [14.0, 28.0, 0.3],
    [21, 30.5, 0.6], [29, 32, 0.6], [38, 32.5, 0.3], [48, 32, 0], [60, 30.5, -0.5], [74, 28, -0.6]],
  rTail: s => s >= 8 ? 0.3 + 1.0 * Math.exp(-(s - 8) / 27.55) : 1.3 + 0.55 * (8 - s),
  blend: 1.4,                                        // mm: smooth-union radius between the neck and the head
  sBreak: 30,                                        // mm of arc from the head's centre: where the fingers take it
  n: 48,                                             // centreline segments
};
export function centreline(ctrl = DROP.ctrl, n = DROP.n) {
  // Catmull-Rom through the control points, then resampled to n equal arc-length segments
  const fine = [], K = 24;
  for (let i = 0; i < ctrl.length - 1; i++) { const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < K; k++) { const u = k / K, u2 = u * u, u3 = u2 * u;
      fine.push([0, 1, 2].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3))); } }
  fine.push(ctrl[ctrl.length - 1].slice());
  const S = [0]; for (let i = 1; i < fine.length; i++) S.push(S[i - 1] + len(sub(fine[i], fine[i - 1])));
  const L = S[S.length - 1], out = [];
  for (let k = 0, j = 0; k <= n; k++) { const s = L * k / n; while (j < S.length - 2 && S[j + 1] < s) j++; const u = (s - S[j]) / Math.max(1e-9, S[j + 1] - S[j]);
    const p = add(fine[j], mul(sub(fine[j + 1], fine[j]), u)); out.push({ p, s }); }
  return { pts: out, length: L };
}
// nearest point on the centreline polyline: arc length s, the point, the unit tangent, the radial vector from the axis to p
export function nearestOnLine(CL, p) {
  let best = null;
  for (let i = 0; i < CL.pts.length - 1; i++) { const a = CL.pts[i].p, b = CL.pts[i + 1].p, ab = sub(b, a), L2 = dot(ab, ab), u = clamp(dot(sub(p, a), ab) / L2);
    const c = madd(a, ab, u), d = sub(p, c), dd = dot(d, d);
    if (!best || dd < best.dd) best = { dd, c, rhoVec: d, t: norm(ab), s: CL.pts[i].s + u * (CL.pts[i + 1].s - CL.pts[i].s), i }; }
  best.rho = Math.sqrt(best.dd); return best;
}
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k); return { d: b + (a - b) * h - k * h * (1 - h), h }; };   // h = 1: all a

// the tail's surface stress falls with its radius (a thinner section quenches with a smaller gradient: the Biot number)
export const tailScale = r => clamp(0.25 + 0.4 * r, 0.3, 1);

// the drop as a body: { sdf, normal, stress, inside } in mm and Pa.
//   freeze: 0..1, the formation's analytic freeze front (1 = the final residual field); the front moves from the skin inward
//   fracture: { tI (us since the front entered the frame), sEnter (mm of arc where it entered), v (mm/us), head entry } -> broken(p)
export function dropBody({ sigmaS = -560e6, a = DROP.head, CL = centreline(), rTail = DROP.rTail, blend = DROP.blend, freeze = 1, fracture = null, tail = true } = {}) {
  const head = sphereField(a, sigmaS);
  const sdfParts = p => { const dh = len(p) - a; if (!tail) return { d: dh, h: 1, nl: null };
    const nl = nearestOnLine(CL, p), dt = nl.rho - rTail(nl.s), m = smin(dh, dt, blend); return { d: m.d, h: m.h, nl }; };
  const sdf = p => sdfParts(p).d;
  const normal = p => { const e = 1e-4; return norm([sdf([p[0] + e, p[1], p[2]]) - sdf([p[0] - e, p[1], p[2]]), sdf([p[0], p[1] + e, p[2]]) - sdf([p[0], p[1] - e, p[2]]), sdf([p[0], p[1], p[2] + e]) - sdf([p[0], p[1], p[2] - e])]); };
  // the formation: the deviatoric field grows in the frozen shell (rn > 1 - freeze), the molten core carries none
  const frozen = (rn, f) => f >= 1 ? 1 : sstep(1 - f - 0.12, 1 - f + 0.12, rn) * sstep(0, 0.25, f);
  const stress = p => {
    const P = sdfParts(p); let S = S0();
    if (P.h > 1e-4) { const r = len(p); S = addS(S, scaleS(head(p), P.h * frozen(r / a, freeze))); }
    if (P.nl && P.h < 1 - 1e-4) { const nl = P.nl, R = rTail(nl.s), ss = sigmaS * tailScale(R);
      S = addS(S, scaleS(cylinderStress(nl.rhoVec, nl.t, R, ss), (1 - P.h) * frozen(Math.min(1, nl.rho / R), Math.min(1, freeze * 3)))); }
    if (fracture && broken(p, fracture, P.nl, P.h) <= 0) S = S0();
    return S;
  };
  return { sdf, normal, stress, n: N_GLASS, a, CL, rTail, kind: 'drop', parts: sdfParts, broken: fracture ? (p => { const P = sdfParts(p); return broken(p, fracture, P.nl, P.h); }) : null };
}
// time (us) until the crack front reaches p (<= 0: already broken). Along the tail the front runs down the arc at v; in the head it fans
// out from where the centreline meets the head's surface, a little faster on some radial lines than others (the branching).
export function frontTime(p, F, nl, h = 0) {
  const v = F.v ?? 1.8, sH = F.sHead ?? 6.4;
  if (nl && h < 0.5 && nl.s > sH) return (F.sEnter - nl.s) / v;
  const E = F.entry || [-2.9, 5.95, 0];
  const d = len(sub(p, E)), dir = norm(sub(p, E)), wob = 0.35 * Math.sin(7.3 * dir[0] + 3.1 * dir[1] + 5.7 * dir[2] + (F.seed ?? 1));
  return (F.sEnter - sH) / v + d / v * (1 + 0.18 * wob);
}
export function broken(p, F, nl, h = 0) { return frontTime(p, F, nl, h) - F.tI; }

// ---------------------------------------------------------------- simple bodies for the closed-form tests
export function slabBody({ t = 1, sigma = 1e6, n = 1.0, w = 50 } = {}) {   // a slab |z| < t/2, uniaxial stress along x
  return { n, sdf: p => Math.max(Math.abs(p[2]) - t / 2, Math.abs(p[0]) - w, Math.abs(p[1]) - w), normal: p => [0, 0, Math.sign(p[2]) || 1],
    stress: () => [sigma, 0, 0, 0, 0, 0], kind: 'slab' };
}
export function discBody({ R = 20, h = 5, P = 200, n = 1.0 } = {}) {      // a disc in x-y, thickness h along z
  const f = discField(R, h, P);
  return { n, field: f, sdf: p => Math.max(Math.hypot(p[0], p[1]) - R, Math.abs(p[2]) - h / 2), normal: p => Math.abs(p[2]) > h / 2 - 1e-6 ? [0, 0, Math.sign(p[2])] : norm([p[0], p[1], 0]),
    stress: f, kind: 'disc' };
}
export function sphereBody({ a = 6, sigmaS = -560e6, n = N_GLASS } = {}) {
  const f = sphereField(a, sigmaS);
  return { n, a, sdf: p => len(p) - a, normal: p => norm(p), stress: f, kind: 'sphere' };
}

// ---------------------------------------------------------------- Fresnel (unpolarised) and Snell
export function fresnel(cosi, n1, n2) {
  const sint = n1 / n2 * Math.sqrt(Math.max(0, 1 - cosi * cosi)); if (sint >= 1) return 1;
  const cost = Math.sqrt(1 - sint * sint), rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost), rp = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
  return 0.5 * (rs * rs + rp * rp);
}
export function refract(d, nrm, eta) {   // nrm faces against d; eta = n1/n2; null on total internal reflection
  const ci = -dot(d, nrm), k = 1 - eta * eta * (1 - ci * ci); if (k < 0) return null;
  return norm(add(mul(d, eta), mul(nrm, eta * ci - Math.sqrt(k))));
}
export const reflect = (d, nrm) => sub(d, mul(nrm, 2 * dot(d, nrm)));
// parallel transport of a transverse frame vector from direction d0 to d1 (the minimal rotation)
export function transport(e, d0, d1) {
  const ax = cross(d0, d1), s = len(ax), c = dot(d0, d1); if (s < 1e-12) return e;
  const k = mul(ax, 1 / s), th = Math.atan2(s, c), ct = Math.cos(th), st = Math.sin(th);
  return add(add(mul(e, ct), mul(cross(k, e), st)), mul(k, dot(k, e) * (1 - ct)));
}
// the lab frame's transverse e1 for a direction: lab x projected (for a ray near the optical axis z)
export function labE1(d) { let e = sub([1, 0, 0], mul(d, d[0])); if (len(e) < 1e-6) e = sub([0, 1, 0], mul(d, d[1])); return norm(e); }

// ---------------------------------------------------------------- one ray
// ray: { o, d } (camera -> scene). opts: { lambdas, C, kind, field, analyser, theta, refraction (false: straight through, n = 1),
//   nMed (the medium round the body), hMax (max step inside, mm), env(dir) -> radiance, glitter(p) -> 0..1 (fragment sparkle) }
export function trace(ray, body, opts = {}) {
  const lambdas = opts.lambdas || [{ l: SODIUM_D, w: 1 }], C = opts.C ?? C_SODALIME, refr = opts.refraction !== false, nMed = opts.nMed ?? 1;
  const nB = refr ? body.n : nMed, hMax = opts.hMax ?? 0.05, maxIt = opts.maxIt ?? 20000, eps = 1e-5;
  let o = ray.o.slice(), d = norm(ray.d), e1 = opts.e1 ? opts.e1.slice() : labE1(d);
  const e1cam = e1.slice(), dcam = d.slice();
  const Ms = lambdas.map(() => J.I());
  let T = 1, inside = false, tir = 0, hits = 0, order = 0, depolL = 0, glow = 0, t = 0, it = 0;
  const tMax = opts.tMax ?? 400;
  while (it++ < maxIt && t < tMax) {
    if (!inside) {
      const dist = body.sdf(o);
      if (dist < eps) {
        const n = body.normal(o), ci = -dot(d, n); hits++;
        const R = fresnel(Math.abs(ci), nMed, nB); T *= 1 - R;
        const dn = refr ? refract(d, ci > 0 ? n : mul(n, -1), nMed / nB) : d;
        if (dn) { e1 = transport(e1, d, dn); d = dn; }
        inside = true; o = madd(o, d, 4 * eps); t += 4 * eps; continue;
      }
      o = madd(o, d, dist); t += dist; continue;
    }
    // inside: a step, bisected to the surface if it leaves
    const din = -body.sdf(o);
    let h = clamp(din, 0.002, hMax), q = madd(o, d, h), leaving = body.sdf(q) > 0;
    if (leaving) { let a = 0, b = h; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (body.sdf(madd(o, d, m)) > 0) b = m; else a = m; } h = (a + b) / 2; q = madd(o, d, h); }
    const mid = madd(o, d, h / 2), S = body.stress(mid), e2 = cross(e1, d), sec = secondary(S, e1, e2);   // (e1, e2, -d) right-handed for the light
    const isBroken = body.broken ? body.broken(mid) <= 0 : false;
    if (isBroken) depolL += h;
    else { order += C * sec.diff * h * 1e-3 / SODIUM_D;
      lambdas.forEach((L, k) => { const dl = 2 * Math.PI * C * sec.diff * h * 1e-3 / L.l; if (dl !== 0) Ms[k] = J.mul(Ms[k], J.retarder(dl, sec.phi)); }); }
    if (opts.emission) glow += opts.emission(mid) * h;
    o = q; t += h;
    if (leaving) {
      const n = body.normal(o), ci = dot(d, n);   // n points out; d leaves
      const R = fresnel(Math.abs(ci), nB, nMed), dn = refr ? refract(d, mul(n, -1), nB / nMed) : d;
      hits++;
      if (!dn || (refr && R >= 1)) { const dr = reflect(d, n); e1 = transport(e1, d, dr); d = dr; tir++; o = madd(o, d, 4 * eps); continue; }
      T *= 1 - R; e1 = transport(e1, d, dn); d = dn; inside = false; o = madd(o, d, 4 * eps);
      // left the body: anything further along? (the drop is star-shaped enough that a second entry is rare: the neck, the tail)
      const ahead = probe(body, o, d, tMax - t); if (ahead == null) break;
    }
  }
  // the source-side frame: where lab x lands in the carried frame
  const e1lab = labE1(d), e2 = cross(e1, d), beta = Math.atan2(dot(e1lab, e2), dot(e1lab, e1));
  const env = opts.env ? opts.env(d) : 1;
  const D = 1 - Math.exp(-(opts.depolK ?? 4) * depolL);   // the fraction of the light scattered (depolarised) by broken glass
  const a = opts.analyser ?? 1;
  let I = 0;
  lambdas.forEach((L, k) => { I += L.w * trainIntensity(Ms[k], { kind: opts.kind || 'circular', field: opts.field || 'dark', analyser: a, theta: opts.theta || 0, beta }); });
  const pol = (1 - D) * I, dep = D * (a * 0.5 + (1 - a)) * (opts.glitter ? opts.glitter : 1);
  return { I: T * env * (pol + dep) + glow, Ipol: I, order, exit: d, o, T, tir, hits, depol: D, beta, M: Ms, e1, e1cam, dcam };
}
// is there any surface ahead along a ray (a coarse sphere trace)? the distance or null
function probe(body, o, d, tMax) { let t = 0; for (let i = 0; i < 400 && t < tMax; i++) { const s = body.sdf(madd(o, d, t)); if (s < 1e-4) return t; t += s; } return null; }

// ---------------------------------------------------------------- a small orthographic image (for the tests and a still to compare the shader with)
export function image(body, { w = 64, h = 64, field = 14, centre = [0, 0], z0 = 30, opts = {} } = {}) {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = centre[0] + ((i + 0.5) / w - 0.5) * field, y = centre[1] - ((j + 0.5) / h - 0.5) * field * h / w;
    out[j * w + i] = trace({ o: [x, y, z0], d: [0, 0, -1] }, body, opts).I;
  }
  return out;
}
// FNV-1a over the float bits rounded to 1e-6: a frame's identity (determinism, T8)
export function frameHash(arr) {
  let hsh = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) { let v = Math.round(arr[i] * 1e6) | 0; for (let k = 0; k < 4; k++) { hsh ^= v & 255; hsh = Math.imul(hsh, 16777619) >>> 0; v >>>= 8; } }
  return hsh.toString(16).padStart(8, '0');
}

// the closed form of T4: fringe order of the analytic head at impact parameter p with refraction off (straight chords)
export const headOrder = (p, a, sigmaS, C = C_SODALIME, l = SODIUM_D) => 2 * C * Math.abs(sigmaS) / l * (p * p / (a * a)) * Math.sqrt(Math.max(0, a * a - p * p)) * 1e-3;
// ... and with refraction: the chord inside a sphere sits at b = p / n from the centre
export const headOrderRefracted = (p, a, sigmaS, n = N_GLASS, C = C_SODALIME, l = SODIUM_D) => headOrder(p / n, a, sigmaS, C, l);
