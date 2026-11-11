// LIGHT / sky: the sun and the sky from one physical model (LIGHTING c1).
//
// Replaces the five hand-picked sky gradients in the stack with one atmosphere, so sky colour, sun colour, the ambient
// it gives and the colour of distant haze all come from the same numbers.
//   solar position   NOAA approximation: day of year + solar time + latitude -> elevation / azimuth
//   clear sky        single scattering in a spherical atmosphere, Rayleigh + Mie + ozone (Bruneton and Neyret 2008
//                    coefficients; Hillaire 2020's structure: a transmittance LUT, then the sky integrated against it),
//                    with a cheap isotropic multiple-scattering term so the zenith is not too dark at twilight
//   overcast         CIE standard overcast sky L(el) = Lz (1 + 2 sin el) / 3, with the sun's position still showing as a
//                    brighter patch, no direct sun
//   night            a near-black sky with industrial skyglow (low cloud lit by sodium) and an optional moon
// Output (cd/m2 and lux, NOT pre-exposed): an equirect Float32 RGBA bake for the dome and the environment, plus
//   sunDir, sunE (rgb lux on a surface facing the sun), skyE (rgb lux on a horizontal surface), horizon (rgb cd/m2).
// World axes: +y up, +x east, -z north.
import { kelvin, luminance } from './color.js';

const RE = 6360e3, RT = 6420e3;
const BR = [5.802e-6, 13.558e-6, 33.1e-6], HR = 8000;
const BM = 3.996e-6, HM = 1200, MIE_ABS = 1.11;
const BO = [0.650e-6, 1.881e-6, 0.085e-6];
export const SOLAR_LUX = 127500;

export function sunDirection(elDeg, azDeg) {
  const e = elDeg * Math.PI / 180, a = azDeg * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
// NOAA-style solar position. day: day of year (1-365), hours: local SOLAR time (12 = noon), lat in degrees
export function solarPosition({ day = 172, hours = 12, lat = 41.5 } = {}) {
  const gma = 2 * Math.PI / 365 * (day - 1 + (hours - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(gma) + 0.070257 * Math.sin(gma) - 0.006758 * Math.cos(2 * gma) + 0.000907 * Math.sin(2 * gma) - 0.002697 * Math.cos(3 * gma) + 0.00148 * Math.sin(3 * gma);
  const ha = (hours - 12) * 15 * Math.PI / 180, la = lat * Math.PI / 180;
  const cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha), zen = Math.acos(Math.max(-1, Math.min(1, cz)));
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(la) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(la) * Math.sin(zen) || 1e-9))));
  az = ha > 0 ? (az + Math.PI) % (2 * Math.PI) : (3 * Math.PI - az) % (2 * Math.PI);
  return { elevation: 90 - zen * 180 / Math.PI, azimuth: az * 180 / Math.PI };
}

const densR = h => Math.exp(-h / HR);
const densO = h => Math.max(0, 1 - Math.abs(h - 25000) / 15000);
const phaseR = c => 3 / (16 * Math.PI) * (1 + c * c);
const phaseM = (c, g) => { const g2 = g * g; return 3 / (8 * Math.PI) * (1 - g2) * (1 + c * c) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * c, 1.5)); };
function rayTop(r, mu) { const d = r * r * (mu * mu - 1) + RT * RT; return -r * mu + Math.sqrt(Math.max(0, d)); }
function hitsGround(r, mu) { return mu < 0 && r * r * (mu * mu - 1) + RE * RE >= 0; }

// a clear-sky atmosphere. turbidity scales the aerosol (Mie) load: 1 clean alpine air, 3 ordinary, 6-10 industrial haze.
// haze: an extra low aerosol layer (scale height hazeH m) for dawn ground haze.
export class Atmosphere {
  constructor({ turbidity = 2.5, hazeH = HM, mieG = 0.78, ozone = 1, groundAlbedo = 0.18 } = {}) {
    this.bm = BM * turbidity; this.hm = hazeH; this.g = mieG; this.oz = ozone; this.alb = groundAlbedo;
    // transmittance LUT T(r, mu): 32 heights x 128 mu
    this.NH = 32; this.NMU = 128; this.T = new Float32Array(this.NH * this.NMU * 3);
    for (let i = 0; i < this.NH; i++) for (let j = 0; j < this.NMU; j++) {
      const h = (i / (this.NH - 1)) ** 2 * (RT - RE), mu = -1 + 2 * j / (this.NMU - 1), t = this._od(RE + h, mu);
      for (let c = 0; c < 3; c++) this.T[(i * this.NMU + j) * 3 + c] = Math.exp(-t[c]);
    }
  }
  _ext(h) { const r = densR(h), m = Math.exp(-h / this.hm), o = densO(h) * this.oz; return [0, 1, 2].map(c => BR[c] * r + this.bm * MIE_ABS * m + BO[c] * o); }
  _od(r, mu) {
    if (hitsGround(r, mu)) return [1e3, 1e3, 1e3];
    const L = rayTop(r, mu), N = 40, od = [0, 0, 0];
    for (let k = 0; k < N; k++) { const s = (k + 0.5) / N * L, h = Math.sqrt(r * r + s * s + 2 * r * s * mu) - RE, e = this._ext(h); for (let c = 0; c < 3; c++) od[c] += e[c] * L / N; }
    return od;
  }
  trans(r, mu, out = [0, 0, 0]) {
    const h = Math.max(0, Math.min(RT - RE, r - RE)), fi = Math.sqrt(h / (RT - RE)) * (this.NH - 1), fj = (Math.max(-1, Math.min(1, mu)) + 1) / 2 * (this.NMU - 1);
    const i0 = Math.min(this.NH - 2, Math.floor(fi)), j0 = Math.min(this.NMU - 2, Math.floor(fj)), a = fi - i0, b = fj - j0;
    for (let c = 0; c < 3; c++) {
      const T = (i, j) => this.T[(i * this.NMU + j) * 3 + c];
      out[c] = (T(i0, j0) * (1 - b) + T(i0, j0 + 1) * b) * (1 - a) + (T(i0 + 1, j0) * (1 - b) + T(i0 + 1, j0 + 1) * b) * a;
    }
    return out;
  }
  // sky radiance (cd/m2, rgb) seen from height h0 along unit dir v, for the sun along s, with solar illuminance E0 (rgb lux)
  radiance(v, s, E0, h0 = 20, N = 20) {
    const r0 = RE + h0, mu = v[1];
    const L = hitsGround(r0, mu) ? -r0 * mu - Math.sqrt(Math.max(0, r0 * r0 * (mu * mu - 1) + RE * RE)) : rayTop(r0, mu);
    const cth = v[0] * s[0] + v[1] * s[1] + v[2] * s[2], pR = phaseR(cth), pM = phaseM(cth, this.g);
    const out = [0, 0, 0], tv = [1, 1, 1], ts = [0, 0, 0], ds = L / N;
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) * ds, px = v[0] * t, py = r0 + v[1] * t, pz = v[2] * t, r = Math.hypot(px, py, pz), h = r - RE;
      const muS = (px * s[0] + py * s[1] + pz * s[2]) / r; this.trans(r, muS, ts);
      const dr = densR(h), dm = Math.exp(-h / this.hm), e = this._ext(h);
      for (let c = 0; c < 3; c++) {
        const sR = BR[c] * dr, sM = this.bm * dm;
        // single scattering + an isotropic multiple-scattering estimate (Hillaire 2020's Psi_ms, collapsed to a constant
        // fraction of the in-scattered sun at that height: it keeps blue in a twilight zenith and lifts a hazy sky)
        const ms = (sR + sM) * ts[c] * 0.08 + (sR + sM) * 0.012 * Math.max(0, muS + 0.15);
        const step = tv[c] * (1 - Math.exp(-e[c] * ds)) / e[c];
        out[c] += E0[c] * step * ((sR * pR + sM * pM) * ts[c] + ms);
        tv[c] *= Math.exp(-e[c] * ds);
      }
    }
    return out;
  }
}

// equirect direction for texture coords (u, v) as three.js samples them (equirectUv: u = atan(z, x) / 2pi + 0.5,
// v = asin(y) / pi + 0.5; a DataTexture's row 0 is v = 0, the nadir)
export function equirectDir(u, v) { const p = (u - 0.5) * 2 * Math.PI, e = (v - 0.5) * Math.PI; return [Math.cos(p) * Math.cos(e), Math.sin(e), Math.sin(p) * Math.cos(e)]; }

// Bake a sky. kind: 'clear' | 'overcast' | 'night'. Returns { data (Float32 RGBA W*H), W, H, sunDir, sunE, skyE, horizon, sunL }.
export function bakeSky(o = {}) {
  const W = o.W ?? 256, H = o.H ?? 128, kind = o.kind ?? 'clear';
  const el = o.elevation ?? 30, az = o.azimuth ?? 135, s = sunDirection(el, az);
  const sunC = kelvin(5778), E0 = sunC.map(v => v * SOLAR_LUX);
  const data = new Float32Array(W * H * 4);
  let sunE = [0, 0, 0], skyE = [0, 0, 0], horizon = [0, 0, 0];
  const alb = o.groundAlbedo ?? 0.18, groundC = o.groundColor ?? [1, 1, 1];
  let skyFn;
  if (kind === 'clear') {
    const atm = new Atmosphere(o);
    const tsun = atm.trans(RE + 20, s[1]); sunE = E0.map((v, c) => v * tsun[c]);
    skyFn = v => atm.radiance(v, s, E0);
  } else if (kind === 'overcast') {
    // horizontal illuminance Eh (lux) under a CIE overcast sky = 7 pi Lz / 9
    const Eh = o.illuminance ?? 16000, Lz = Eh * 9 / (7 * Math.PI), col = kelvin(o.kelvin ?? 6800), n = luminance(col);
    skyFn = v => { const sinel = Math.max(0, v[1]), cs = v[0] * s[0] + v[1] * s[1] + v[2] * s[2]; const k = Lz * (1 + 2 * sinel) / 3 * (1 + (o.sunPatch ?? 0.35) * Math.exp((cs - 1) * 6)); return col.map(c => c / n * k); };
    sunE = [0, 0, 0];
  } else {
    // night: zenith ~0.002 cd/m2, skyglow from the town and the plant on low cloud toward the horizon (HPS-coloured)
    const zen = o.zenith ?? 0.0025, glow = o.skyglow ?? 0.25, gc = o.glowColor ?? [1.6, 0.75, 0.25], blue = kelvin(9000);
    const moon = o.moon ?? 0; const ms = o.moonDir ?? sunDirection(o.moonEl ?? 35, o.moonAz ?? 200);
    skyFn = v => { const e = Math.max(0, v[1]), gl = glow * Math.exp(-e / 0.16) * (0.75 + 0.25 * Math.cos(Math.atan2(v[0], -v[2]) - (o.glowAz ?? 0) * Math.PI / 180));
      const cm = v[0] * ms[0] + v[1] * ms[1] + v[2] * ms[2];
      return [0, 1, 2].map(c => zen * blue[c] * (0.6 + 0.4 * e) + gl * gc[c] + moon * 0.04 * Math.exp((cm - 1) * 5)); };
    sunE = [0, 0, 0];
    if (moon > 0) { const mc = kelvin(4300); sunE = mc.map(c => c * moon); }
  }
  // the upper hemisphere first (rows H/2..H-1), with its cosine-weighted irradiance on a horizontal surface
  const half = H / 2;
  for (let j = half; j < H; j++) {
    const v = (j + 0.5) / H, e = (v - 0.5) * Math.PI, dOm = (2 * Math.PI / W) * (Math.PI / H) * Math.cos(e);
    for (let i = 0; i < W; i++) {
      const d = equirectDir((i + 0.5) / W, v), L = skyFn(d), k = (j * W + i) * 4;
      data[k] = L[0]; data[k + 1] = L[1]; data[k + 2] = L[2]; data[k + 3] = 1;
      for (let c = 0; c < 3; c++) skyE[c] += L[c] * Math.max(0, d[1]) * dOm;
      if (j === half) for (let c = 0; c < 3; c++) horizon[c] += L[c] / W;
    }
  }
  // the ground (rows 0..H/2-1): a lambertian plane lit by the sun and the sky, seen through the low atmosphere
  const gE = [0, 1, 2].map(c => sunE[c] * Math.max(0, s[1]) + skyE[c]);
  for (let j = 0; j < half; j++) {
    const v = (j + 0.5) / H, down = -Math.sin((v - 0.5) * Math.PI), f = Math.exp(-down * 8);
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 4;
      for (let c = 0; c < 3; c++) data[k + c] = (alb * groundC[c] * gE[c] / Math.PI) * (1 - f * 0.6) + horizon[c] * f * 0.6;
      data[k + 3] = 1;
    }
  }
  // sun disc radiance (for the dome): E / solid angle of a 0.265 deg radius disc
  const sunL = sunE.map(v => v / 6.8e-5);
  return { data, W, H, kind, sunDir: s, elevation: el, azimuth: az, sunE, skyE, horizon, sunL };
}
