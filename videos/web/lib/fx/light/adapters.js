// LIGHT / adapters: the same light record driving the other renderers in the stack (LIGHTING c1, critique L1).
//
//   sdfLook(rig)      -> a `look` for sdf.js render(t, { look }): sun direction and colour, sky top / horizon / ground, fog,
//                        all PRE-EXPOSED from the physical sky (so an sdf.js shot and a LitRenderer shot of the same
//                        preset agree on light), rim off (no kicker from nowhere), exposure 1. sdf.js still applies its own
//                        tone curve at the end; for the house display transform render it with post defaults and grade
//                        in light/display.js's terms (see capabilities/lighting.md).
//   threeLights(rig)  -> { sun, env, background } for a three.js scene rendered elsewhere (objects/stage.js, world3d.js):
//                        hand them to the scene instead of a key + hemi + rim; set that renderer's exposure to 1, since
//                        the values are already exposed.
//   relightLayers(rig)-> the practicals as named layers { name, light, level(t) } for relight.js-style per-light bakes.
import { luminance } from './color.js';

const pre = (rgb, e) => rgb.map(v => v * e);
export function sdfLook(rig, { fogScale = 1 } = {}) {
  const s = rig.sky, e = rig.exposure, W = s.W, H = s.H;
  const px = (u, v) => { const i = Math.min(W - 1, Math.floor(u * W)), j = Math.min(H - 1, Math.floor(v * H)), k = (j * W + i) * 4; return [s.data[k], s.data[k + 1], s.data[k + 2]]; };
  // zenith and horizon averaged round the azimuth; ground from the bake's lower hemisphere
  const ring = v => { const a = [0, 0, 0]; for (let i = 0; i < 16; i++) { const p = px((i + 0.5) / 16, v); a[0] += p[0] / 16; a[1] += p[1] / 16; a[2] += p[2] / 16; } return a; };
  const top = pre(ring(0.97), e), horizon = pre(ring(0.505), e), ground = pre(ring(0.3), e);
  const sunC = pre(s.sunE, e / Math.PI);
  const at = rig.atmos;
  return {
    sun: { dir: s.sunDir, color: sunC }, sky: { top, horizon, ground },
    fog: { color: horizon, density: at.density * fogScale, falloff: 1 / at.height, scatter: Math.min(1, luminance(sunC) / Math.max(luminance(horizon), 1e-6) * 0.1) },
    amb: 1, exposure: 1, rim: [1, 1, 1, 0], vol: 1,
  };
}
export function threeLights(rig) { return { sun: rig.sun, env: rig.env, background: rig.skyTex, exposure: rig.exposure }; }
export function relightLayers(rig) { return rig.practicals.map(P => ({ name: P.spec.name || P.spec.kind, light: P.light, practical: P, level: t => P.update(t) })); }
