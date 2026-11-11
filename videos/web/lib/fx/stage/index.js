// STAGE (HUMAN c8 round 4, judge c9 step 3): a real ground, light that reads as photographed, and contact, as ONE call, for every
// board. Opt-in: nothing imports this unless it asks; lib/fx/light/ is used, not changed.
//
//   import { makeStage } from '/web/lib/fx/stage/index.js';
//   const S = await makeStage('studio' | 'window' | 'yard' | 'lot' | 'shop', { scene, renderer: lr.renderer, extent, center });
//   // S.rig replaces `new LightRig(...)` (exposure, white balance, key, fill, lamps); S.objects are in the scene (floor, set)
//   S.updateContact([P.h.group, ...]);                      // after the people are placed / posed, before each render
//   lr.render({ scene, camera, rig: S.rig, lens, ...S.renderOpts });   // K (soft key), AO radius, contact length
//   S.cycles   // the record videos/blender/stage_scene.py builds the same stage from (camera-independent)
//
// Each stage (stages.js): a ground texture set (assets/stage/, made by videos/blender/stage_textures.py, read by both renderers), a set
// (paper sweep | room wall | yard wall | plane), a key (the rig's directional light: one direction for a whole row), the fill as an
// environment (indoors: env.js roomEnv; outdoors: the rig's physical sky), extra lamps (practicals), and the ground contact map
// (contact.js). Exposure stays the lab's: metered at the faces (person meterPeople / lane B's rule) or the record's ev100.
import * as THREE from 'three';
import { LightRig } from '../light/rig.js';
import { PRESETS } from '../light/presets.js';
import { kelvin } from '../light/color.js';
import { STAGES, STAGE_NAMES, stageRecord } from './stages.js';
import { roomEnv, envFor } from './env.js';
import { buildSet, setContact, stageMaterial } from './grounds.js';
import { ContactMap } from './contact.js';
import { cyclesRecord } from './record.js';
import { recordWB, stageWB } from './wb.js';
import { bgStops } from '../light/camera7.js';
export { STAGES, STAGE_NAMES, stageRecord, ContactMap, roomEnv, stageMaterial, cyclesRecord, stageWB };

// opts: scene, renderer (required); extent (m: the key's shadow box half size, ~ the row's half width + 1), center ([x, y, z] of the
// shadow box), shadowSize (4096), contact (false = no contact map), people (roots to make the first contact map from), lens (rec.lens
// overrides), K (sub-frames override)
// (LIGHT5) override: fields shallow-merged over the record (tuning a look from a lab query: lab_stage's s5=<json>); the grey-card
// balance then follows the overridden light only when the override names camera.wb 'card' (else the named stage's own)
// (CAMERA7) skinBias: the person's exposure compensation in stops (camera7.js skinBias(skinY)); a lab that cannot pass options (lab_person) names it in its URL
// as `bias7=<stops>`; `camera7: false` turns a '@7' stage's camera off (its light stays), `camera7: {..}` overlays its preset (display fields, expo, lens, sensor);
// a lab's URL may carry `c7=0` (off), `c7=1` (on, a stage with no camera7 gets the photographic display alone) or `c7=<json>` ({ display: {..}, lens, sensor }) over the stage's camera7
export async function makeStage(name, { scene, renderer, extent = 3, center = [0, 1, 0], shadowSize = 4096, contact = true, people = null, lens = null, K = null, contactOpts = {}, override = null, skinBias = null, camera7: c7opt } = {}) {
  const S = override ? { ...stageRecord(name), ...override } : stageRecord(name), t0 = performance.now();
  let camera7 = null, bgS = 0;   // bgS: the seamless's stops (CAMERA7 rev 2: it tracks the skin compensation, stages.js `bg`)
  {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null, cq = q ? q.get('c7') : null;   // c7=0 off, c7=1 or <json> on (over the stage's camera7, or alone on a stage with none)
    if ((S.camera7 || (cq && cq !== '0')) && c7opt !== false && cq !== '0') {
      const bias = skinBias ?? (q && q.get('bias7') != null ? +q.get('bias7') : 0), urlC7 = cq && cq !== '1' ? JSON.parse(cq) : {};
      const o = { ...(S.camera7 || {}), ...(c7opt && typeof c7opt === 'object' ? c7opt : {}), ...urlC7 }; camera7 = { ...o, expo: (o.expo ?? 0) + bias }; if (S.bg) bgS = bgStops(bias, S.bg);
    }
  }
  // ---- the light record (lib/fx/light/rig.js): physical sky outdoors; indoors a clear sky only for the rig's key mechanism (its colour,
  // lux and size are set below), the disc off and no haze
  const indoor = S.key !== 'physical';
  const base = S.sky?.kind === 'overcast' ? 'overcastNoon' : 'lookdev';
  const cardWB = override?.camera?.wb === 'card' ? recordWB(S) : recordWB(name);   // LIGHT5: camera.wb 'card' (the '@5' stages): the grey card's balance, set on the rig below
  const rec = PRESETS[base]({
    camera: { ...S.camera, ...(cardWB ? { wb: null } : {}) },
    sky: indoor ? { kind: 'clear', elevation: S.key.elevation, azimuth: S.key.azimuth, turbidity: 2, disc: false, groundAlbedo: S.groundAlbedo } : { ...S.sky, groundAlbedo: S.groundAlbedo },
    sun: { extent, center, shadowSize, softness: indoor ? (S.key.size / 2) / (0.0047 * 180 / Math.PI) : 1, bias: -0.0002, normalBias: 0.03 },
    atmosphere: indoor ? { density: 1e-6, height: 10 } : { density: 0.00035, height: 200 },
    lens: { bloom: 0.02, halation: 0.1, vignette: 0.22, grain: 0.012, ...(S.lens || {}), ...(lens || {}) },
    practicals: (S.lamps || []).map(l => ({ ...l, cd: (l.cd ?? (l.cdPerLux ?? 0) * (S.key.lux ?? 0)) })),
  });
  const rig = new LightRig(renderer, scene, rec);
  if (cardWB) rig.wb = cardWB;
  if (S.set && S.set.back != null) rig.followWall = { z: -S.set.back, y: 1.55 };   // CAMERA7: where a lamp with follow 'camera' finds the wall (LightRig.followCamera)
  // indoors: the key's colour and lux, the room's environment as the fill (pre-exposed, as the rig stores its sky)
  let env = null;
  if (indoor) {
    const c = kelvin(S.key.kelvin ?? 5600), mx = Math.max(...c); rig.sun.color.setRGB(c[0] / mx, c[1] / mx, c[2] / mx); rig.sun.intensity = S.key.lux * mx * rig.exposure;
    rig.sky.sunE = c.map(v => v * S.key.lux); rig.sunOn = true; rig.sun.visible = true; rig.sun.castShadow = true;
    env = envFor(S.env, S.key.lux);
    const ex = rig.exposure, pd = new Float32Array(env.data.length); for (let i = 0; i < pd.length; i++) pd[i] = (i & 3) === 3 ? 1 : Math.min(6e4, env.data[i] * ex);
    const tex = new THREE.DataTexture(pd, env.W, env.H, THREE.RGBAFormat, THREE.FloatType); tex.mapping = THREE.EquirectangularReflectionMapping; tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.LinearSRGBColorSpace; tex.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(renderer); const e2 = pm.fromEquirectangular(tex).texture; pm.dispose();
    scene.background = tex; scene.environment = e2; rig.skyTex = tex; rig.env = e2;
    rig.sky.skyE = [0, 0, 0];   // ambientL (the volume pass) reads it; no haze indoors
  }
  // ---- the ground, the set, the contact map
  const C = contact ? new ContactMap(renderer, { radius: S.contact?.radius ?? 0.45, strength: S.contact?.strength ?? 1, ...contactOpts }) : null;
  // (CAMERA7) the backdrop tracks the exposure: a seamless's tint (studio@7), or (c2) a room's plaster wall (window@7: wallTint)
  const trackedS = !bgS ? S : S.set?.tint ? { ...S, set: { ...S.set, tint: S.set.tint.map(v => v * 2 ** bgS) } } : (S.set?.kind === 'room' && S.set.wallTint) ? { ...S, set: { ...S.set, wallTint: S.set.wallTint.map(v => v * 2 ** bgS) } } : S;
  const { objects, floor } = await buildSet(trackedS, C);
  for (const o of objects) scene.add(o);
  const stage = {
    name, record: S, rec, rig, objects, floor, contact: C, env,
    renderOpts: { K: K ?? S.render?.K ?? 3, ao: { ...(S.render?.ao || {}) }, contactLen: S.render?.contactLen ?? 0.6, ...(camera7 ? { camera7 } : {}) },
    label: S.label, ms: 0,
    // LIGHT5: the key's angular radius (deg) for an analytic catchlight (FACE5's eyes f5.keyDeg), null when the key is the physical sun
    // (0.27 deg) or there is none; the grey card's balance (null: the record's kelvin)
    camera7, bgStops: bgS,
    keyHalfDeg: indoor ? S.key.size / 2 : (S.sky?.kind === 'clear' ? 0.27 : null), wb: cardWB ? stageWB(override?.camera?.wb === 'card' ? S : name) : null, rev: S.rev ?? 4,
    // remake the contact map from the people as they now stand (call after placing / posing, before rendering)
    updateContact(roots, o = {}) { if (!C) return null; C.update(scene, roots, o); setContact(floor.material, C); return C; },
    dispose() { for (const o of objects) { scene.remove(o); o.geometry.dispose(); } C?.dispose(); },
    cycles: cyclesRecord(name),
  };
  if (people) stage.updateContact(people);
  stage.ms = Math.round(performance.now() - t0);
  return stage;
}
