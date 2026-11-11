// STAGE (round 4): the stage records. A stage is a GROUND (a texture set from videos/blender/stage_textures.py, the same files Cycles
// reads), a SET (the geometry round it: a paper sweep, a room's back wall, a yard wall), and LIGHT that reads as photographed (a key
// with its colour, size and lux, the fill as an environment, any extra lamps), plus the render settings that ground a figure
// (accumulated sub-frames for the soft key, the screen-space AO radius, the contact map). Plain data: stage_export.mjs writes it
// to assets/stage/stages.json for videos/blender/stage_scene.py, so the two renderers build the same stage.
//
// Frame: lab_person's front view. People stand round the origin facing +z; the camera is on +z looking -z; camera LEFT is -x.
// Directions are lib/fx/light/sky.js sunDirection(elevation, azimuth): azimuth 180 = from behind the camera, 270 = from camera left,
// 225 = from front-left (a classic 45-degree key). Luminances in cd/m2, illuminances in lux, before exposure.
//
// key   { elevation, azimuth, lux, kelvin, size (deg: the source's angular DIAMETER as the subject sees it; the soft shadow) }
//       The key is the rig's directional light (lib/fx/light/rig.js 'sun'): one direction for the whole row, so twelve people in
//       a row get the same light (a real softbox at 3 m would light the row's ends a stop down). sky: 'physical' = the rig's own
//       clear-sky sun (colour and lux from the atmosphere model: outdoors).
// env   'physical' (the rig's sky: outdoors) | { kind: 'room', up, side, down (cd/m2, as fractions of key lux: the fill a room gives),
//       patches: [{ elevation, azimuth, w, h (deg), L (fraction of key lux, cd/m2 per lux), kelvin }] }: the fill and the catchlights.
// lamps extra lights (lib/fx/light/practicals.js specs, positions in metres; 'cdPerLux' = candela per lux of key)
import { portraitSeat } from './frusta.js';
import { CAMERA7_LENS } from '../light/camera7.js';
export const STAGES = {
  // ---------------------------------------------------------------- a studio: seamless paper, three lights
  studio: {
    label: 'studio: paper sweep, softbox key, fill card, hair light',
    ground: 'paper', tile: 2,
    set: { kind: 'sweep', back: 3.4, cove: 1.6, height: 7, width: 30, front: 16, material: 'paper' },
    key: { elevation: 34, azimuth: 222, lux: 2400, kelvin: 5600, size: 22 },
    env: { kind: 'room', kelvin: 5600, up: 0.004, side: 0.006, down: 0.05,     // down: the paper's own bounce (0.3 x sin 34 / pi)
      patches: [
        { name: 'fill', elevation: 8, azimuth: 132, w: 46, h: 40, L: 0.30, kelvin: 5600, soft: 6 },        // a big white fill card, camera right
        { name: 'key', elevation: 34, azimuth: 222, w: 20, h: 22, L: 0.35, kelvin: 5600, soft: 3 },        // the softbox face (catchlight + its spread)
      ] },
    lamps: [{ name: 'hair', kind: 'point', pos: [1.2, 5.2, -3.0], aim: [0, 1.4, 0.2], half: 0.75, pen: 0.8, size: 0.35, cdPerLux: 9, color: 5600, shadow: false, head: 'none' }],
    camera: { ev100: 8.9, wb: 5600 },
    groundAlbedo: 0.3, render: { K: 16, ao: { radius: 0.9, intensity: 2.0 }, contactLen: 0.5 }, contact: { radius: 0.5, strength: 1.4 },
  },
  // ---------------------------------------------------------------- indoors: a big window to camera left, boards, a plaster wall
  window: {
    label: 'room: worn boards, a large window key from the left, the room as fill',
    ground: 'wood', tile: 2,
    set: { kind: 'room', back: 4.5, height: 4.2, width: 40, wall: 'plaster', wallTint: [0.44, 0.46, 0.42], skirting: 0.14 },
    key: { elevation: 24, azimuth: 248, lux: 1800, kelvin: 6200, size: 30 },
    env: { kind: 'room', kelvin: 4600, up: 0.008, side: 0.010, down: 0.025,   // down: the boards' bounce (0.18 x sin 24 / pi)
      patches: [
        { name: 'window', elevation: 22, azimuth: 248, w: 40, h: 44, L: 0.11, kelvin: 7000, soft: 2 },     // the window itself: sky beyond the glass
        { name: 'wall', elevation: 10, azimuth: 120, w: 70, h: 40, L: 0.02, kelvin: 4800, soft: 20 },       // the lit wall opposite: the bounce
      ] },
    lamps: [],
    camera: { ev100: 8.0, wb: 5600 },
    groundAlbedo: 0.18, render: { K: 16, ao: { radius: 0.9, intensity: 2.0 }, contactLen: 0.5 }, contact: { radius: 0.5, strength: 1.4 },
  },
  // ---------------------------------------------------------------- outdoors: a sunny yard, packed earth, a block wall behind
  yard: {
    label: 'yard: packed earth, sun key from front-left, clear sky fill, a wall behind',
    ground: 'earth', tile: 2,
    set: { kind: 'yard', back: 10, height: 2.6, width: 80, wall: 'plaster', wallTint: [0.78, 0.74, 0.68] },
    sky: { kind: 'clear', elevation: 40, azimuth: 222, turbidity: 3.2 },
    key: 'physical', env: 'physical',
    lamps: [],
    camera: { ev100: 14.6, wb: 5600 },
    groundAlbedo: 0.2, render: { K: 4, ao: { radius: 0.9, intensity: 1.8 }, contactLen: 0.5 }, contact: { radius: 0.5, strength: 1.4 },
  },
  // the same yard on asphalt (a lot)
  lot: { extends: 'yard', label: 'lot: weathered asphalt, sun key, clear sky, a wall behind', ground: 'asphalt', groundAlbedo: 0.11 },
  // ---------------------------------------------------------------- a shop floor under skylights: concrete, overcast top light
  // (the old 'over' light on real ground: isolates ground + contact from the light)
  shop: {
    label: 'shop: sealed concrete, overcast skylight',
    ground: 'concrete', tile: 2,
    set: { kind: 'plane' },
    sky: { kind: 'overcast', illuminance: 17000, kelvin: 6800, elevation: 50, azimuth: 160, groundAlbedo: 0.2 },
    key: 'physical', env: 'physical', lamps: [],
    camera: { ev100: 12.9, wb: 6500 },
    groundAlbedo: 0.2, render: { K: 3, ao: { radius: 0.9, intensity: 2.0 }, contactLen: 0.5 }, contact: { radius: 0.5, strength: 1.4 },
  },
};
export const STAGE_NAMES = Object.keys(STAGES);

// ---------------------------------------------------------------- LIGHT5 (round 5, judge c10 steps 4-5): each stage's round-5 look
// OPT-IN BY NAME: 'studio@5', 'window@5', 'yard@5', 'lot@5', 'shop@5', 'overcast' (= 'overcast@5', new). A name without '@5' is STAGE's
// round-4 record exactly (every existing board, lab and Cycles call renders as before); 'record' is the round-4 studio by its own
// name (the near-frontal softbox: comparison rows only). Each '@5' record is the round-4 one with these fields replaced (shallow per
// field: a field given here replaces the whole field).
//   camera.wb 'card': white balance on an 18 % grey card at the face, facing the camera (wb.js): the key at its cosine + the
//   environment's irradiance, inverted per channel in linear Rec.709, so a swatch of any albedo reads the same on every stage (both
//   renderers take the same matrix from the record). The exposure stays the lab's (metered at the face, lane B's rule).
//   render.ao: the screen-space AO's contact ring at 0.25 x radius = 9 cm (arm against side, under the chin, folded arms; was 22 cm)
//   with the room ring at 0.36 m, a little stronger.
const AO5 = { radius: 0.36, intensity: 2.6 };
export const STAGES5 = {
  // a portrait studio: the key 45 deg camera left and 40 up (loop light: the nose shadow falls toward the far lip corner), a 14 deg
  // source (a 1 m octabox at 4 m: a defined but soft shadow edge, and its disc is the catchlight), the fill a broad bounce near the lens
  // (camera right of it: lifts every shadow without making a second one), the paper's bounce for a lit pool (not an infinite lit
  // floor). NO RIM by default: a rim from behind turned the engine's v4 hair orange (HAIR4's TRT lobe, HAIR5's finding) and lightened
// Cycles' dark hair (farm job 1003-212128): the rim is 'studio_rim@5' until HAIR5's rev-5 hair colour lands. Measured on paper
  // (light5_test.mjs, rgb lux on small cards at the face): key side (45 deg toward the key) : shadow side (45 deg away) about 4.5 : 1;
  // incident ratio (key + fill) : fill facing the lens about 5.5 : 1 (the fill 2.2 stops under the key). Round 4: 3.5 : 1 and 5.9 : 1,
  // with the key 42 deg round and 34 up, a 22 deg source and a big cross fill: the near-front planes of a face got 86 % of the key.
  studio: {
    label: 'portrait studio: 45/40 loop key (14 deg), fill near the lens, rim from behind right, paper sweep',
    key: { elevation: 40, azimuth: 225, lux: 2400, kelvin: 5600, size: 14 },
    env: { kind: 'room', kelvin: 5600, up: 0.004, side: 0.005, down: 0.035,
      patches: [
        { name: 'fill', elevation: 5, azimuth: 160, w: 40, h: 36, L: 0.40, kelvin: 5600, soft: 8 },         // a big bounce beside the lens, camera right
        { name: 'key', elevation: 40, azimuth: 225, w: 13, h: 15, L: 0.2, kelvin: 5600, soft: 3 },         // the octabox face: its spread
      ] },
    lamps: [],
    camera: { ev100: 8.9, wb: 'card' },
    render: { K: 16, ao: AO5, contactLen: 0.5 },
  },
  window: { label: 'room (r5): window key from the left, white-balanced on a grey card', camera: { ev100: 8.0, wb: 'card' }, render: { K: 16, ao: AO5, contactLen: 0.5 } },
  yard: { label: 'yard (r5): sun key, clear sky, white-balanced on a grey card', camera: { ev100: 14.6, wb: 'card' }, render: { K: 4, ao: { ...AO5, intensity: 2.2 }, contactLen: 0.5 } },
  lot: { label: 'lot (r5): asphalt, sun key, white-balanced on a grey card', camera: { ev100: 14.6, wb: 'card' }, render: { K: 4, ao: { ...AO5, intensity: 2.2 }, contactLen: 0.5 } },
  shop: { label: 'shop (r5): concrete under overcast skylight, white-balanced on a grey card', camera: { ev100: 12.9, wb: 'card' }, render: { K: 3, ao: AO5, contactLen: 0.5 } },
};
// the portrait studio with a RIM from behind camera right, far enough (14 m) that a row of twelve gets one direction (~1400 lux on a
// head, 5600 K, no shadow): for when the hair takes a back light (HAIR5 rev 5); round 5 only ('studio_rim' = 'studio_rim@5')
STAGES5.studio_rim = { ...STAGES5.studio, label: 'portrait studio + rim from behind right (for HAIR5 rev-5 hair)',
  lamps: [{ name: 'rim', kind: 'spot', pos: [7.0, 6.2, -12.0], aim: [0, 1.45, 0], half: 0.42, pen: 0.6, size: 0.6, cdPerLux: 125, color: 5600, shadow: false, head: 'none' }] };
STAGES.studio_rim = { extends: 'studio', label: 'portrait studio + rim (round 5 only)', rev: 5 };
// a new stage (round 5 only): the yard under a CIE overcast sky (no sun: the soft top light of a grey day outdoors)
STAGES.overcast = { extends: 'yard', label: 'overcast: packed earth, a wall behind, CIE overcast sky (no sun), grey-card white balance',
  sky: { kind: 'overcast', illuminance: 17000, kelvin: 6800, elevation: 50, azimuth: 160 }, key: 'physical', env: 'physical',
  camera: { ev100: 12.9, wb: 'card' }, render: { K: 3, ao: AO5, contactLen: 0.5 }, rev: 5 };
// the round-4 studio by name, for record rows
STAGES.record = { extends: 'studio', label: 'record: STAGE round-4 studio (near-frontal softbox), for comparison rows' };
// every name a stage can be asked for: the round-4 five, 'record', 'overcast', and each '<name>@5'
export const STAGE_NAMES5 = [...Object.keys(STAGES5).map(n => n + '@5'), 'overcast', 'studio_rim'];
// 'name' or 'name@5' -> { base, rev }
export function parseStage(name) { const m = /^(.*)@(\d+)$/.exec(name || ''); return m ? { base: m[1], rev: +m[2] } : { base: name, rev: STAGES[name]?.rev ?? 4 }; }
// a stage record with its 'extends' resolved ('<name>@5': the round-5 fields over it)
export function stageRecord(name) {
  const { base, rev } = parseStage(name);
  const S = STAGES[base]; if (!S) throw new Error(`stage: no stage '${name}' (${STAGE_NAMES.join(', ')}, record, overcast, <name>@5)`);
  const R = S.extends ? { ...stageRecord(S.extends), ...S, extends: undefined } : S;
  if (rev < 5 || base === 'overcast') return R;   // ('studio_rim' carries rev 5: it takes its STAGES5 fields below)
  if (rev >= 7) {   // CAMERA7: a '@7' look is the '@5' one (where there is one) with its own fields over it
    const Y = STAGES7[base]; if (!Y) throw new Error(`stage: no round-7 look for '${base}' (${Object.keys(STAGES7).join(', ')})`);
    return { ...R, ...(STAGES5[base] || {}), ...Y, rev: 7 };
  }
  const X = STAGES5[base]; if (!X) throw new Error(`stage: no round-5 look for '${base}' (${Object.keys(STAGES5).join(', ')})`);
  return { ...R, ...X, rev: 5 };
}

// ---------------------------------------------------------------- CAMERA7 (round 7): PHOTOGRAPHIC looks, by name ('studio@7', 'window@7'). The '@5' looks are untouched.
// What a photograph's light has that '@5' does not (review/studio_human_c8/after/camera7/NOTES.md; tools/c7stats.py against the c3 portraits):
//   * the light has a SHAPE: the key's octabox is hot in the middle and falls off toward its edge (it is what a cornea mirrors), the room behind the camera
//     is dark (the cornea's rim and the skin's sheen mirror it), a black flag stands on the shadow side and a white card low in front lifts the sockets and the
//     chin and puts a second, low catchlight in the eye (env.js roomEnv7). The fill is '@5''s (4.5:1 key side to shadow side), the card adds ~3 %;
//   * a portrait is lit apart from its backdrop: a separate background light (a spot behind the subject, aimed along the wall, out of the subject's cone: no rim
//     on the hair) gives the wall the gradient a photograph's has, and it FOLLOWS THE CAMERA (lamp `follow: 'camera'`: LightRig.followCamera in the engine,
//     camera7_stage.aim_bg in Cycles), as a photographer lights the background for the lens: the wall's gradient is the same for every head and every camera;
//   * the camera: 'camera7' names the preset (camera7.js): an 85 mm at f/5.6, the photographic display (per-channel curve, white at +3.6 stops, one global
//     chroma gain, no hue band), output sharpening, and the exposure rule that places every skin where the photographs place it (skinBias): the lab passes the
//     person's bias as `bias7`.
// Portrait stage: the halo is one lamp at x = 0 (a row of twelve gets it behind the middle). `lens` here overlays the rig's lens (vignette, grain, bloom).
export const STAGES7 = {
  studio: {
    label: 'photographic portrait studio (r7): hot softbox key, wide dim fill, low card, flagged room, slate backdrop that tracks the exposure with a wide halo that follows the camera, 85 mm f/5.6 + output sharpening',
    set: { kind: 'sweep', back: 3.4, cove: 1.6, height: 7, width: 30, front: 16, material: 'paper', tint: [0.6, 0.74, 0.9] },
    key: { elevation: 40, azimuth: 225, lux: 2400, kelvin: 5600, size: 14 },
    env: { kind: 'room7', kelvin: 5600, up: 0.003, side: 0.003, down: 0.03,
      walls: [{ azimuth: 180, w: 150, k: 0.35 }],                                                                  // the studio behind the camera: dark
      flags: [{ elevation: 4, azimuth: 70, w: 100, h: 90, k: 0.2, soft: 12 }],                                     // a black flag on the shadow side
      patches: [
        { name: 'key', elevation: 40, azimuth: 225, w: 13, h: 15, L: 0.2, kelvin: 5600, soft: 3, falloff: 0.45 },   // the octabox's face: its spread, hot in the middle
        { name: 'fill', elevation: 5, azimuth: 145, w: 40, h: 36, L: 0.42, kelvin: 5600, soft: 8 },                // a big bounce 35 degrees off the lens axis
        { name: 'card', elevation: -24, azimuth: 195, w: 70, h: 24, L: 0.06, kelvin: 5200, soft: 8 },             // a white card low in front of the subject
      ] },
    lamps: [{ name: 'bg', kind: 'spot', pos: [0.25, 0.3, -1.5], aim: [0, 1.9, -5.0], half: 0.95, pen: 1.0, size: 0.3, cdPerLux: 11, color: 5600, shadow: false, head: 'none', follow: 'camera' }],   // the pool is wide enough that a head turned 15 degrees still sees its centre
    camera: { ev100: 8.9, wb: 'card' },
    camera7: { lens: 'portrait56', sharpen: true },                                                              // an 85 mm at f/5.6 (a studio headshot is shot at f/5.6-f/8: the skin plane sharp from brow to chin), the threshold unsharp mask after the aperture accumulation
    bg: { track: 1.385, offset: 0.578 },                                                                         // the seamless tracks the skin compensation: stops = -(track * bias + offset) on the paper's tint (camera7.js bgStops): mid grey for every skin, not white for the deep ones

    render: { K: 32, ao: AO5, contactLen: 0.5 },                                                              // 32 sub-frames: the thin lens's aperture samples
  },
};
// window@7: the light a photographer finds indoors, DERIVED FROM A ROOM (c3 iteration 2: the window is ONE emitter). One casement window (0.9 m x 1.2 m, six panes, 3.2 m from the sitter,
// camera left and 28 degrees up) is a rectangle of sky with a radiance: window.js derives that radiance from the lux it must give the face (about 17,000 cd/m2 with the mullions in),
// and everything the window does follows from the rectangle: the key's angular size (key.size = the disc of the same solid angle, 21 degrees, 0.10 sr: the soft shadow, the cornea's
// analytic disc), the light on the plaster wall behind the sitter (it falls off with distance and the wall's tilt to the window: no lamp), and, in Cycles, the window itself in the cornea and
// on the skin's sheen (the rectangle with its panes at its true radiance, in place of the sun and a dim patch). The engine keeps the directional key for the face (shadow map, sub-frame
// soft key) and lights the wall with the rectangle's irradiance (grounds.js: window.js wallRatio). Cool daylight (6400 K) key, the warm room (4300 K) as fill at a photograph's key:shadow
// ratio (~4:1), the room behind the camera dark, the walls a room's (set.room: a seeded furnished wall, room.js), 85 mm f/5.6 + output sharpening. No background lamp, no tracking of the
// wall to the skin: the wall's level against the face is the room's physics, and the camera's exposure (skinBias) moves both together, as a photograph's does.
const WINDOW = { w: 0.9, h: 1.2, d: 3.2 };
const winSolid = ({ w, h, d }) => 4 * Math.asin((w * h / 4) / Math.sqrt((d * d + w * w / 4) * (d * d + h * h / 4)));          // the solid angle of a rectangle on its axis, sr
const winDeg = ({ w, h, d }) => ({ w: 2 * Math.atan(w / 2 / d) * 180 / Math.PI, h: 2 * Math.atan(h / 2 / d) * 180 / Math.PI, disc: 2 * Math.acos(1 - winSolid({ w, h, d }) / (2 * Math.PI)) * 180 / Math.PI });
export const WINDOW7 = { ...WINDOW, ...winDeg(WINDOW), omega: winSolid(WINDOW) };
STAGES7.window = {
  label: 'photographic window light (r7): a 0.9 x 1.2 m casement window 3.2 m away (21 degrees, 0.10 sr) as ONE emitter: the cool key, the light on the furnished wall behind and the window in the eye; the warm room as fill (4:1), 85 mm f/5.6 + output sharpening',
  set: { kind: 'room', back: 3.2, height: 4.2, width: 40, wall: 'plaster', wallTint: [0.50, 0.46, 0.40], skirting: 0.14, room: { seed: 32, file: 'room_r7_s32.json', x0: -6, w: 12, h: 4.2, seat: portraitSeat({ back: 3.2, lenses: CAMERA7_LENS }) } },   // wallTint: a mid-tone warm paint (reflectance ~0.23 with the plaster's 0.5); room: furniture as real geometry (room.js); the seat is DERIVED (frusta.js): the wall every portrait camera of the studio (face, bust, full, long-lens face) sees from any angle to +-35 degrees round the sitter, plus the lens' blur, is kept clear
  key: { elevation: 28, azimuth: 238, lux: 1750, kelvin: 6400, size: +WINDOW7.disc.toFixed(1), emitter: true,
    window: { w: +WINDOW7.w.toFixed(1), h: +WINDOW7.h.toFixed(1), distance: WINDOW.d, width_m: WINDOW.w, height_m: WINDOW.h, head: [0, 1.55, 0],
      panes: { nx: 2, ny: 3, bar_m: 0.04, dark: 0.85 }, vgrad: [0.8, 1.25], tintBot: [1, 1, 1], tintTop: [0.86, 0.95, 1.12] } },   // six panes, 4 cm bars; the sky brighter and bluer overhead
  env: { kind: 'room7', kelvin: 4300, up: 0.012, side: 0.014, down: 0.034,                                       // the room: warm, a little lit; down: the boards' bounce (the window is NOT in it: it is the emitter)
    walls: [{ azimuth: 180, w: 160, k: 0.35 }],                                                                   // the room behind the camera: dark
    patches: [
      { name: 'room', elevation: 6, azimuth: 122, w: 90, h: 58, L: 0.16, kelvin: 4300, soft: 22, falloff: 0.35 },   // the pale wall camera right: the fill
      { name: 'card', elevation: -26, azimuth: 200, w: 70, h: 24, L: 0.05, kelvin: 4000, soft: 8 },              // the boards' warm bounce under the chin
    ] },
  camera: { ev100: 8.0, wb: 'card' },
  camera7: { lens: 'portrait56', sharpen: true },
  render: { K: 32, ao: AO5, contactLen: 0.5 },
};
export const STAGE_NAMES7 = Object.keys(STAGES7).map(n => n + '@7');
