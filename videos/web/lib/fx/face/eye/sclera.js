// EYES: the white of the eye grown from its anatomy (sources in model.js). An equirectangular map over the globe about the corneal axis:
// u = the angle round the axis (0 temporal, 0.25 up, 0.5 nasal, as iris.js), v = theta / THETA_MAX (0 the corneal apex, 1 at 100 degrees).
// The bulbar conjunctiva's vessels are GROWN (roots at the fornices, tortuous, branching, thinning toward the limbus, stopping short of the
// clear perilimbal band; the anterior ciliary vessels at the rectus insertions, the spiral of Tillaux); the diffuse blood is denser in the
// exposed nasal and temporal wedges and toward the fornices; conjunctival melanin (perilimbal and interpalpebral) follows the person's skin
// melanin; the albedo comes through model.js scleraSpectrum (Kubelka-Munk over the choroid). Also out: the limbal transition (the opaque
// sclera's edge over the clear cornea, 0..1) for the renderers.
import { scleraSpectrum, rgbOf, ANAT } from './model.js';
import { rng, pnoise } from './iris.js';

export const THETA_MAX = 100 * Math.PI / 180;
const TAU = Math.PI * 2;
// the limbus' angle from the axis at azimuth a on a globe of radius gr (the horizontal ellipse rl x rlv)
export const limbusTheta = (a, gr = ANAT.globeR, rl = ANAT.cornea.wtw / 2, rlv = (ANAT.cornea.wtw - ANAT.cornea.vertLess) / 2) => {
  const rho = 1 / Math.sqrt((Math.cos(a) / rl) ** 2 + (Math.sin(a) / rlv) ** 2); return Math.asin(Math.min(0.99, rho / gr)); };

export function growSclera(M, { seed = 1, side = 1, age = 30, skinCm = 0.05, NU = 2048, NV = 512, gr = ANAT.globeR } = {}) {
  const t0 = Date.now(), R = rng(seed * 40503 + (side > 0 ? 11 : 12)), N = pnoise(seed * 17 + (side > 0 ? 5 : 6));
  const vess = new Float32Array(NU * NV);   // blood thickness (mm) of the vessels in the texel
  const thLim = a => limbusTheta(a, gr), clear = 1.4 / gr;   // the perilimbal clear band (~1.4 mm: the palisades' zone, few large vessels)
  const toUV = (th, a) => [((a / TAU) % 1 + 1) % 1 * NU, th / THETA_MAX * NV];
  // splat a vessel segment (th, a in radians; w = diameter mm) as blood thickness with a round profile
  function seg(th0, a0, th1, a1, w) {
    const n = Math.max(1, Math.ceil(Math.hypot((th1 - th0) * gr, (a1 - a0) * gr * Math.sin(th0)) / 0.02));
    for (let k = 0; k <= n; k++) { const th = th0 + (th1 - th0) * k / n, a = a0 + (a1 - a0) * k / n, [u, v] = toUV(th, a);
      const pu = TAU * gr * Math.sin(th) / NU, pv = THETA_MAX * gr / NV, ru = Math.ceil(w / pu) + 1, rv = Math.ceil(w / pv) + 1;
      for (let dv = -rv; dv <= rv; dv++) { const iv = Math.floor(v) + dv; if (iv < 0 || iv >= NV) continue;
        for (let du = -ru; du <= ru; du++) { const iu = ((Math.floor(u) + du) % NU + NU) % NU, d = Math.hypot((iu + 0.5 - u - NU * Math.round((iu + 0.5 - u) / NU)) * pu, (iv + 0.5 - v) * pv) / (w / 2);
          if (d >= 1.3) continue; const t = d < 1 ? w * Math.sqrt(1 - d * d) : 0, q = iv * NU + iu; if (t > vess[q]) vess[q] = t; } } }
  }
  // grow one vessel from (th, a) toward the limbus
  function grow(th, a, w, head, depth, steps = 500) {
    for (let k = 0; k < steps; k++) {
      const lim = thLim(a) + clear * (0.6 + 0.6 * N(a / TAU * 40, 7.5, 40));
      if (th < lim || w < 0.007) return;
      head += (R() - 0.5) * 0.9 + 0.08 * (0 - head);                       // tortuous, pulled back toward the limbus (heading 0 = -theta)
      const st = 0.12, dth = -st * Math.cos(head) / gr, da = st * Math.sin(head) / (gr * Math.max(0.2, Math.sin(th)));
      seg(th, a, th + dth, a + da, w); th += dth; a += da; w *= 0.993;
      if (depth < 4 && R() < 0.03) grow(th, a, w * 0.75, head + (R() < 0.5 ? -1 : 1) * (0.7 + 0.6 * R()), depth + 1, 220);
    }
  }
  // conjunctival vessels: roots at the fornices, denser in the exposed nasal and temporal wedges
  // calibre: most of the bed is capillaries too fine to see; the visible conjunctival vessels ~10-40 um, more and wider with age
  let nRoot = 0; const cal = 1 + 0.5 * Math.max(0, (age - 25) / 35);
  for (let k = 0; k < 400 && nRoot < 48; k++) { const a = R() * TAU, wgt = 0.25 + 0.75 * Math.abs(Math.cos(a)) ** 2; if (R() > wgt) continue;
    nRoot++; grow((62 + 26 * R()) * Math.PI / 180, a, (0.012 + 0.024 * R() * R()) * cal, (R() - 0.5) * 1.2, 0); }
  // the anterior ciliary vessels: two per rectus insertion (lateral 6.9, superior 7.7, medial 5.5, inferior 6.5 mm from the limbus), wider,
  // straighter, coming forward to the limbus
  for (const [a, mm] of [[0, 6.9], [Math.PI / 2, 7.7], [Math.PI, 5.5], [Math.PI * 1.5, 6.5]]) for (let k = 0; k < 2; k++) {
    const aa = a + (k - 0.5) * 0.28 + (R() - 0.5) * 0.08, th = thLim(aa) + mm / gr; let t = th, b = aa, w = (0.03 + 0.02 * R()) * cal, head = 0;
    for (let s = 0; s < 80; s++) { const lim = thLim(b) + 0.6 / gr; if (t < lim) break; head += (R() - 0.5) * 0.45 - 0.15 * head;
      const dth = -0.12 * Math.cos(head) / gr, da = 0.12 * Math.sin(head) / (gr * Math.sin(t)); seg(t, b, t + dth, b + da, w); t += dth; b += da; w *= 0.985; } }
  // the albedo: diffuse blood (wedges, fornices, age in the spectrum), melanin (perilimbal, interpalpebral), the vessels
  const albedo = new Float32Array(NU * NV * 3), limb = new Float32Array(NU * NV), cache = new Map();
  const melP = 0.025 * skinCm;
  for (let iv = 0; iv < NV; iv++) { const th = (iv + 0.5) / NV * THETA_MAX;
    for (let iu = 0; iu < NU; iu++) { const a = (iu + 0.5) / NU * TAU, q = iv * NU + iu, tl = thLim(a), dmm = (th - tl) * gr;
      const wedge = Math.abs(Math.cos(a)) ** 3 * Math.exp(-(((th - 0.9) / 0.5) ** 2));
      const blood = 1 + 1.6 * wedge + 1.2 * Math.max(0, Math.min(1, (th - 1.0) / 0.45)) + 0.35 * (N(a / TAU * 30, th * 12, 30) - 0.5) * 2;
      const patch = N(a / TAU * 50 + 9, th * 20, 50);
      const mel = melP * (Math.exp(-(((dmm - 1.5) / 1.4) ** 2)) * (0.4 + 1.2 * patch) + 0.6 * wedge * patch);
      const kB = Math.round(Math.max(0.3, blood) * 20), kM = Math.round(mel * 4000), kV = Math.round(Math.min(0.08, vess[q]) * 2000), key = kB * 1e7 + kM * 1e3 + kV;
      let c = cache.get(key); if (!c) { c = rgbOf(M, scleraSpectrum(M, { age, blood: kB / 20, mel: kM / 4000, vessel: kV / 2000 })); cache.set(key, c); }
      albedo[q * 3] = c[0]; albedo[q * 3 + 1] = c[1]; albedo[q * 3 + 2] = c[2];
      limb[q] = Math.max(0, Math.min(1, dmm / ANAT.limbus.band)); } }
  return { NU, NV, thetaMax: THETA_MAX, seed, side, age, albedo, vessels: vess, limbus: limb, counts: { roots: nRoot, colours: cache.size }, ms: Date.now() - t0 };
}
