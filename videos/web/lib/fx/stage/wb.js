// LIGHT5 (round 5, judge c10 step 4): white balance on a GREY CARD, per stage, the same numbers for the engine and Cycles.
// Pure JS (no three): runs in the page, in node (light5_test.mjs) and writes into stages.json (record.js) for blender/.
//
// A photographer white-balances on an 18 % grey card held at the face, facing the lens. Here the card's illuminant is computed from
// the stage record itself: the key at its cosine on the card (rgb lux) + the environment's irradiance on it (the room's surround and
// patches, or the physical sky and its ground). The balance is a per-channel gain in linear Rec.709 (the renderers' working space):
// for an RGB renderer this is exact, so a swatch of ANY albedo lit by that light reads its own albedo, whatever the stage's colour
// temperature (a Bradford adaptation, as color.js whiteBalance does for a named kelvin, is exact only for the white). Luminance of
// white is kept (Y of the gains x E = Y of E), so exposure is untouched (the labs still meter at the face).
//   cardIlluminant(name) -> { rgb (lux), key (rgb lux), env (rgb lux), n (the card normal) }
//   cardWB(rgb) -> row-major 3x3 (the rig's .wb and record.wb)       stageWB(name) -> { matrix, rgb, cct, duv }
import { stageRecord } from './stages.js';
import { envFor, envIrradiance } from './env.js';   // (CAMERA7: envFor = roomEnv, or roomEnv7 for a 'room7' spec)
import { sunDirection, bakeSky } from '../light/sky.js';
import { kelvin, luminance, M709_TO_XYZ } from '../light/color.js';

const CARD_N = [0, 0, 1];   // the card faces the lens (lab_person's front view: the camera on +z)
export function cardIlluminant(name, { n = CARD_N, W = 128, H = 64 } = {}) {
  const S = typeof name === 'string' ? stageRecord(name) : name;     // a stage name, or a record (a lab's tuned override)
  let key, env;
  if (S.key === 'physical') {
    const b = bakeSky({ ...(S.sky || {}), groundAlbedo: S.groundAlbedo, W, H });
    const c = Math.max(0, b.sunDir[0] * n[0] + b.sunDir[1] * n[1] + b.sunDir[2] * n[2]);
    key = b.sunE.map(v => v * c); env = envIrradiance({ data: b.data, W, H }, n);
  } else {
    const d = sunDirection(S.key.elevation, S.key.azimuth), c = Math.max(0, d[0] * n[0] + d[1] * n[1] + d[2] * n[2]);
    key = kelvin(S.key.kelvin ?? 5600).map(v => v * S.key.lux * c); env = envIrradiance(envFor(S.env, S.key.lux, { W, H }), n);
  }
  return { rgb: key.map((v, i) => v + env[i]), key, env, n };
}
export function cardWB(rgb) {
  const Y = luminance(rgb), g = rgb.map(v => Y / Math.max(v, 1e-9));
  return [g[0], 0, 0, 0, g[1], 0, 0, 0, g[2]];
}
// the illuminant's correlated colour temperature (McCamy) and its distance from the Planckian locus (duv, Ohno's sign: + = greenish),
// for the notes' table
export function cctOf(rgb) {
  const X = M709_TO_XYZ[0] * rgb[0] + M709_TO_XYZ[1] * rgb[1] + M709_TO_XYZ[2] * rgb[2], Yv = M709_TO_XYZ[3] * rgb[0] + M709_TO_XYZ[4] * rgb[1] + M709_TO_XYZ[5] * rgb[2],
    Z = M709_TO_XYZ[6] * rgb[0] + M709_TO_XYZ[7] * rgb[1] + M709_TO_XYZ[8] * rgb[2], s = X + Yv + Z, x = X / s, y = Yv / s;
  const nn = (x - 0.3320) / (0.1858 - y), cct = 449 * nn ** 3 + 3525 * nn ** 2 + 6823.3 * nn + 5520.33;
  const u = 4 * x / (-2 * x + 12 * y + 3), v = 6 * y / (-2 * x + 12 * y + 3);
  // the locus point at that CCT (Krystek's approximation of the Planckian uv)
  const T = cct, up = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T),
    vp = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T);
  const duv = Math.sign(v - vp) * Math.hypot(u - up, v - vp);
  return { cct: Math.round(cct), duv: +duv.toFixed(4), xy: [+x.toFixed(4), +y.toFixed(4)] };
}
export function stageWB(name) {
  const I = cardIlluminant(name);
  return { matrix: cardWB(I.rgb), rgb: I.rgb.map(v => +v.toFixed(1)), keyLux: +luminance(I.key).toFixed(0), envLux: +luminance(I.env).toFixed(0), ...cctOf(I.rgb) };
}
// the white-balance matrix a stage's record asks for: 'card' -> stageWB; a kelvin or lamp name -> null (the caller's whiteBalance)
export function recordWB(name) { const S = typeof name === 'string' ? stageRecord(name) : name; return S.camera?.wb === 'card' ? stageWB(name).matrix : null; }
