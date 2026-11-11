// OBJECTIVE / spectral (Oct 2026; the series engine): wavelengths, narrowband filters, blackbody glow and monochrome-to-display. An
// instrument's light is its own colour: a sodium-line filter makes a polariscope amber and black, never a grade. The band's colour is the
// CIE 1931 2-degree colour of the filtered band (light/color.js cie), brought inside sRGB in Oklab at constant lightness and hue (it sits
// on the spectral locus, out of gamut), at unit luminance; the one display transform (light/display.js) then takes it to the screen.
//
//   bandSamples(589.3e-9, 10e-9, 5)  -> [{ l, w }]  Gauss-Hermite nodes of the Gaussian filter (exact integration of the band)
//   bandColour(589.3e-9, 10e-9)      -> linear Rec.709 [r, g, b] at luminance 1 (amber)
//   bandFromRGB                      -> weights taking a linear-RGB world plate to radiance in the 589 nm band (an approximation)
//   glow(T)                          -> { rgb (luminance 1), Y (cd/m2 of a blackbody surface) } for incandescent glass
import { cie, xyzTo709, blackbody } from '../light/color.js';
import { lin2oklab, oklab2lin } from '../light/display.js';
export { bandSamples, visibility, SODIUM_D } from './polariscope_ref.js';

export function bandXYZ(l0 = 589.3e-9, fwhm = 10e-9) {
  const sig = fwhm / (2 * Math.sqrt(2 * Math.LN2)) * 1e9, c = l0 * 1e9; let X = 0, Y = 0, Z = 0, W = 0;
  for (let l = c - 5 * sig; l <= c + 5 * sig; l += sig / 20) { const w = Math.exp(-0.5 * ((l - c) / sig) ** 2), [x, y, z] = cie(l); X += w * x; Y += w * y; Z += w * z; W += w; }
  return [X / W, Y / W, Z / W];
}
// the band's colour inside sRGB: Oklab chroma reduced (lightness and hue kept) until every channel is >= 0, then scaled to luminance 1
export function bandColour(l0 = 589.3e-9, fwhm = 10e-9) {
  const XYZ = bandXYZ(l0, fwhm), rgb = xyzTo709(XYZ.map(v => v / XYZ[1]));
  const lab = lin2oklab(rgb.map(v => Math.max(v, 0) === v ? v : v));   // (cbrt of a negative is fine in JS)
  let lo = 0, hi = 1;
  const at = k => oklab2lin([lab[0], lab[1] * k, lab[2] * k]);
  if (Math.min(...at(1)) >= 0) lo = 1; else for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (Math.min(...at(m)) >= 0) lo = m; else hi = m; }
  const c = at(lo).map(v => Math.max(0, v)), Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map(v => v / Y);
}
// a world plate (linear Rec.709) to radiance in the 589 nm band: 589 nm sits between the G (~545 nm) and R (~610 nm) primaries' peaks,
// so the band's value of a smooth spectrum is taken by interpolating between them in wavelength (68 % R, 32 % G, no B)
export const bandFromRGB = [0.68, 0.32, 0.0];
// incandescent glass: the blackbody colour at T (kelvin) and its luminance; glass is a poor emitter when thin, the caller scales by path
export function glow(Tk) { if (Tk < 700) return { rgb: [0, 0, 0], Y: 0 }; const b = blackbody(Tk); return { rgb: b.rgb, Y: b.Y }; }
// celsius helper
export const K = c => c + 273.15;
