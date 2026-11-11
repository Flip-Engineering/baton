// STAGE / record: what Cycles needs to build a stage (videos/blender/stage_scene.py), from stages.js alone (pure JS: no three; node's
// stage_export.mjs writes it to assets/stage/stages.json with each stage's environment as .hdr). Camera-independent.
//   key: dir (toward the light, three's frame: +y up, the camera on +z), rgbLux (rgb lux on a surface facing it), angleDeg (its size)
//   env: { kind: 'room' | 'sky', file } the surround (cd/m2) the engine fills with; lamps: practicals with candela
import { STAGES, stageRecord, parseStage } from './stages.js';
import { sunDirection, bakeSky } from '../light/sky.js';
import { kelvin, lampRGB, whiteBalance } from '../light/color.js';
import { envFor } from './env.js';   // (CAMERA7: roomEnv, or roomEnv7 for a 'room7' spec)
import { recordWB } from './wb.js';
import { windowEmitter } from './window.js';   // (CAMERA7 c3 i2: a window@7 is ONE emitter: Cycles gets the rectangle, not a sun)
// the .hdr file of a stage's environment: the round-4 file when the light that makes it (key, env, sky) is the round-4 stage's own
// ('window@5', 'record': the same file), else '<name>_r5_env.hdr' (no '@' in served paths)
const lightOf = R => JSON.stringify([R.key, R.env, R.sky, R.groundAlbedo]);
export function envFile(name) {
  const { base, rev } = parseStage(name), S = STAGES[base];
  if (rev >= 5 && S?.extends && STAGES[S.extends] && lightOf(stageRecord(name)) === lightOf(stageRecord(S.extends + '@5'))) return envFile(S.extends + '@5');   // studio_rim: studio@5's
  if (rev >= 5 && base !== 'overcast' && lightOf(stageRecord(name)) === lightOf(stageRecord(base))) return `${base}_env.hdr`;
  if (S?.extends && lightOf(stageRecord(base)) === lightOf(stageRecord(S.extends)) && !STAGES[S.extends].extends && rev < 5) return `${S.extends}_env.hdr`;
  return `${String(name).replace('@', '_r')}_env.hdr`;
}

export function cyclesRecord(name) {
  const S = stageRecord(name), phys = S.key === 'physical';
  let key;
  if (phys) { const sky = S.sky || {}, b = bakeSky({ ...sky, W: 8, H: 4 }); key = { dir: b.sunDir, rgbLux: b.sunE, angleDeg: 0.53, physical: true }; }
  else key = { dir: sunDirection(S.key.elevation, S.key.azimuth), rgbLux: kelvin(S.key.kelvin ?? 5600).map(v => v * S.key.lux), angleDeg: S.key.size };
  if (!phys && S.key.emitter) key.emitter = windowEmitter(S.key).record();   // CAMERA7 c3 i2: the window's rectangle (centre, axes, size, the radiance image): stage_scene.py builds an emissive mesh and NO sun
  return { name, label: S.label, ground: S.ground, tile: S.tile ?? 2, set: S.set, groundAlbedo: S.groundAlbedo, camera: S.camera, ...(S.camera7 ? { camera7: S.camera7 } : {}), ...(S.bg ? { bg: S.bg } : {}), ...(S.lens ? { lens: S.lens } : {}), wb: recordWB(name) ?? whiteBalance(S.camera?.wb ?? 6504), key,
    env: { kind: phys ? 'sky' : 'room', file: envFile(name) },
    lamps: (S.lamps || []).map(l => ({ ...l, rgb: lampRGB(l.color ?? 3200), cd: l.cd ?? (l.cdPerLux ?? 0) * (S.key.lux ?? 0) })) };
}
// the environment array a stage fills with (cd/m2, three's equirect, row 0 = nadir): the room's, or the physical sky's bake
export function stageEnv(name, { W = 512, H = 256 } = {}) {
  const S = stageRecord(name);
  if (S.key === 'physical') { const b = bakeSky({ ...(S.sky || {}), groundAlbedo: S.groundAlbedo, W, H }); return { data: b.data, W, H }; }
  return envFor(S.env, S.key.lux, { W, H });
}
export const STAGE_LIST = Object.keys(STAGES);   // (round 5 adds 'overcast' and 'record' here; the '@5' names: STAGE_NAMES5)
