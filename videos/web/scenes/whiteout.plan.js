// WHITEOUT (WINTER SHIFT ep.1): the shots, the lenses and the light (research/series/snowbelt/ep1_brief.md "Timeline", "Frame 0",
// "Light records"). Long lenses, locked off or tracking at vehicle height; no push-in anywhere. Before the turn the weather makes every
// cut (lib/fx/whiteout.js swaps the shot only inside a white); after it the work does (a hook takes the load, a tarp flap is pulled
// aside, a worker walks out), and the ending holds.
// Exposure: the series' display (light/display.js) puts white at +6.5 stops, so "exposed for the snow" here means the air and the
// snowfield sit 5-6 stops over mid grey: the EV100 values below are calibrated in node to that (they are ~3 stops brighter than the
// brief's meter figures, which assumed a display with less headroom), and the snow-blind grade then sets snow at 0.94-0.97.
import * as THREE from 'three';
import { TL, CUTS } from './whiteout.weather.js';
import { SETS } from './whiteout.world.js';

const D2R = Math.PI / 180, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const fovFromMM = mm => 2 * Math.atan(18 / mm) / D2R;     // vertical FOV on the 9:16 frame, full-frame equivalent (36 mm tall)

// ------------------------------------------------------------------ the light records (light/ PRESETS as bases; the scene adds practicals)
// air: the medium's own radiance as a display value (Whiteout.airL); white: what the air goes to in a cut (lit by the shot's lamps at night)
export const LOOKS = {
  dusk:  { base: 'overcastNoon', rec: { camera: { ev100: 4.6, wb: 5600 }, sky: { kind: 'overcast', illuminance: 600, kelvin: 9000, elevation: -3, azimuth: 200, groundAlbedo: 0.8, sunPatch: 0 },
    atmosphere: { density: 0.0025, height: 600, albedo: 0.99, g: 0.8, ambient: 0, maxDist: 350 }, lens: { bloom: 0.03, halation: 0.12, vignette: 0.1, grain: 0.022 } },
    air: 0.982, white: 0.99, tint: null },
  site:  { base: 'overcastNoon', rec: { camera: { ev100: 3.4, wb: 5600 }, sky: { kind: 'overcast', illuminance: 260, kelvin: 9500, elevation: -4, azimuth: 220, groundAlbedo: 0.8, sunPatch: 0 },
    atmosphere: { density: 0.003, height: 600, albedo: 0.99, g: 0.78, ambient: 0, maxDist: 350 }, lens: { bloom: 0.035, halation: 0.18, vignette: 0.1, grain: 0.024 } },
    air: 0.975, white: 0.99, tint: null },
  night: { base: 'sodiumNight', rec: { camera: { ev100: 3.4, wb: 4300 }, sky: { kind: 'night', skyglow: 0.35, zenith: 0.003, glowColor: [1.2, 0.95, 0.92], glowAz: 160, groundAlbedo: 0.8 },
    atmosphere: { density: 0.004, height: 400, albedo: 0.99, g: 0.76, ambient: 0, maxDist: 250 }, lens: { bloom: 0.045, halation: 0.3, vignette: 0.16, grain: 0.03 }, bounce: { albedo: 0.8, n5: false } },
    air: 0.62, white: 0.985, tint: [1.0, 0.93, 0.92] },
  tent:  { base: 'sodiumNight', rec: { camera: { ev100: 6.1, wb: 4000 }, sky: { kind: 'overcast', illuminance: 220, kelvin: 9500, elevation: -4, azimuth: 220, groundAlbedo: 0.8, sunPatch: 0 },
    atmosphere: { density: 0.02, height: 6, albedo: 0.95, g: 0.6, ambient: 1, maxDist: 30 }, lens: { bloom: 0.05, halation: 0.3, vignette: 0.16, grain: 0.028 }, bounce: { albedo: 0.35, n5: false } },
    air: null, white: null, tint: null },
  end:   { base: 'sodiumNight', rec: { camera: { ev100: 3.6, wb: 4300 }, sky: { kind: 'night', skyglow: 0.32, zenith: 0.003, glowColor: [1.2, 0.95, 0.92], glowAz: 200, groundAlbedo: 0.8 },
    atmosphere: { density: 0.0035, height: 400, albedo: 0.99, g: 0.76, ambient: 0, maxDist: 300 }, lens: { bloom: 0.045, halation: 0.3, vignette: 0.14, grain: 0.03 }, bounce: { albedo: 0.8, n5: false } },
    air: 0.6, white: 0.985, tint: [1.0, 0.94, 0.92] },
};

// ------------------------------------------------------------------ the shots
// Each: { id, t0, t1, set, look, mm, focus, fstop, cam(t) -> { pos, yaw, pitch }, weather: {...}, cast: [[name, clip, place(t) -> { pos, yaw, tc, pingpong }]] }
const pk = { frame0: { x: SETS.ROAD[0] + 6.25, z0: -85, v: 14 } };
// frame 0's lens: 1.45 m up on the left gravel shoulder; turned 2.94 deg toward the road so the pickup at 85 m sits at x ~ 640
export const F0 = { pos: V(SETS.ROAD[0], 1.45, 0), yaw: -2.94 * D2R, pitch: 1.5 * D2R };
// a point given in a camera's own frame (x right, y up, z back) -> world
export function camToWorld(c, x, y, z) { const e = new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ'), q = new THREE.Quaternion().setFromEuler(e); return V(x, y, z).applyQuaternion(q).add(c.pos); }
// the tripod's shiver in the wind (0.3 px RMS at 2-6 Hz; scaled by the wind)
const shiver = (t, w = 1) => { const a = 0.0045 * D2R * w; return [a * (Math.sin(t * 13.1 + 1.3) * 0.6 + Math.sin(t * 27.7) * 0.4), a * (Math.sin(t * 17.9 + 0.4) * 0.6 + Math.sin(t * 33.3 + 2) * 0.4)]; };

const ER = SETS.ER[0], ST = SETS.SITE[0];
export const SHOTS = [
  { id: 'frame0', t0: 0, t1: TL.w1, set: 'road', look: 'dusk', mm: 85, focus: 9, fstop: 4,
    cam: t => { const [a, b] = shiver(t); return { pos: F0.pos.clone(), yaw: F0.yaw + a, pitch: F0.pitch + b }; },
    weather: { dmin: 2.6, ground: 0, drift: true, count: 340000 },
    pickup: t => ({ pos: V(pk.frame0.x, 0, pk.frame0.z0 - pk.frame0.v * t), yaw: Math.PI, tail: 1, head: 0 }) },
  { id: 'ontario', t0: TL.w1, t1: TL.w2, set: 'road', look: 'dusk', mm: 85, focus: 25, fstop: 5.6,
    cam: t => ({ pos: V(SETS.ROAD[0] + 5.9, 1.25, -330 - 19.44 * (t - TL.w1)), yaw: 0.6 * D2R + 0.002 * Math.sin(t * 2.3), pitch: 0.4 * D2R + 0.0015 * Math.sin(t * 3.7 + 1) }),
    weather: { dmin: 3.2, ground: 0, drift: true, count: 340000 } },
  { id: 'us', t0: TL.w2, t1: TL.w3, set: 'road2', look: 'dusk', mm: 85, focus: 25, fstop: 5.6,
    cam: t => ({ pos: V(SETS.ROAD2[0] + 5.9, 1.25, -1200 + 25 - 19.44 * (t - 8.8)), yaw: 0.6 * D2R + 0.002 * Math.sin(t * 2.1 + 2), pitch: 0.4 * D2R + 0.0015 * Math.sin(t * 3.3) }),
    weather: { dmin: 3.2, ground: 0, drift: true, count: 340000 },
    pickup: t => { const cz = -1200 + 25 - 19.44 * (t - 8.8); return { pos: V(SETS.ROAD2[0] + 6.25, 0, cz - 72 - 2.5 * Math.sin((t - TL.w2) * 0.6)), yaw: Math.PI, tail: 1, head: 0 }; } },
  { id: 'dark', t0: TL.w3, t1: TL.w4, set: 'dark', look: 'dusk', mm: 200, focus: 140, fstop: 5.6,
    cam: t => ({ pos: V(SETS.DARK[0] - 140, 1.6, 1.5), yaw: -90 * D2R, pitch: 1.97 * D2R }),
    weather: { dmin: 9.0, ground: 0, drift: true, count: 340000 } },
  { id: 'houlton', t0: TL.w4, t1: TL.w5, set: 'er', look: 'night', mm: 135, focus: 40, fstop: 4,
    cam: t => ({ pos: V(ER + 0.8, 1.5, 32), yaw: 0.6 * D2R, pitch: 1.0 * D2R }),
    weather: { dmin: 9.0, ground: 0, drift: true, count: 300000 },
    cast: [['L22_f27_black', 'row7', t => ({ pos: V(ER + 0.2, 0, -9.3), yaw: 0, tc: t - TL.w4 + 1.0, pingpong: true })],
           ['L06_f53_white', 'row7', t => ({ pos: V(ER + 1.5, 0, -10.5), yaw: -0.25, tc: t - TL.w4 + 3.1, pingpong: true })]] },
  { id: 'glass', t0: TL.w5, t1: TL.w6, set: 'er', look: 'night', mm: 135, focus: 37, fstop: 4,
    cam: t => ({ pos: V(ER - 0.6, 1.45, 28), yaw: -0.5 * D2R, pitch: 0.4 * D2R }),
    weather: { dmin: 9.0, ground: 0, drift: true, count: 300000 },
    // she lifts a supply box from behind the counter and carries it across the station (lift7: the squat ~1.9 s, the carry from ~3.75 s)
    cast: [['L22_f27_black', 'lift7', t => ({ pos: V(ER - 0.9, 0, -9.6), yaw: 0, tc: t - 25.2 })],
           ['L06_f53_white', 'row7', t => ({ pos: V(ER + 1.1, 0, -9.4), yaw: -0.15, tc: t - TL.w5 + 0.4, pingpong: true })]] },
  { id: 'lot', t0: TL.w6, t1: TL.w7, set: 'er', look: 'night', mm: 85, focus: 20, fstop: 4,
    cam: t => ({ pos: V(ER + 2.6, 1.55, 3.2), yaw: Math.PI + 1.5 * D2R, pitch: -0.8 * D2R }),
    weather: { dmin: 4.0, ground: 0, drift: true, count: 340000 },
    pickup: t => { const u = Math.max(0, t - 33.0); return { pos: V(ER + 4.0, 0, 34 + 6 * u + 0.45 * u * u), yaw: 0, tail: 1, head: 1 }; } },
  { id: 'site', t0: TL.w7, t1: TL.act1, set: 'site', look: 'site', mm: 85, focus: 70, fstop: 5.6,
    cam: t => ({ pos: V(ST + 42, 3.0, 58), yaw: 33 * D2R, pitch: 1.2 * D2R }),
    weather: { dmin: 4.0, ground: 0, drift: false, count: 260000 },
    cast: [['L12_f39_white', 'row7', t => ({ pos: V(ST + 11.4, 0.25, 10.4), yaw: 0.9, tc: t - TL.w7, pingpong: true })],
           ['L23_m45_white', 'row7', t => ({ pos: V(ST + 16.8, 0.25, 7.9), yaw: -0.6, tc: t - TL.w7 + 2.2, pingpong: true })],
           ['L21_m32_black', 'walk7', t => ({ pos: V(ST + 9.5, 0.25, 0.6), yaw: 0.2, tc: 0 })]] },
  { id: 'steel', t0: TL.act1, t1: TL.act2, set: 'site', look: 'site', mm: 135, focus: 38, fstop: 4,
    cam: t => ({ pos: V(ST + 30, 0.95, 40), yaw: 31 * D2R, pitch: 6.0 * D2R }),
    weather: { dmin: 6.0, ground: 0, drift: false, count: 260000 },
    cast: [['L12_f39_white', 'row7', t => ({ pos: V(ST + 11.4, 0.25, 10.4), yaw: 0.9, tc: t - TL.w7, pingpong: true })]] },
  { id: 'heat', t0: TL.act2, t1: TL.act3, set: 'site', look: 'tent', mm: 50, focus: 6, fstop: 2.8,
    cam: t => ({ pos: V(ST - 14 - 5.3, 1.45, -8 + 0.6), yaw: -90 * D2R, pitch: -2 * D2R }),
    weather: { enabled: false },
    cast: [['L17_m28_hispanic', 'lift7', t => ({ pos: V(ST - 14 - 1.0, 0.25, -8 + 2.3), yaw: 0, tc: t - TL.act2 + 3.4 })],
           ['L21_m32_black', 'walk7', t => ({ pos: V(ST - 14 + 1.2, 0.25, -8 - 0.4), yaw: 0, tc: t - 55.5 })]] },
  { id: 'end', t0: TL.act3, t1: 999, set: 'newh', look: 'end', mm: 135, focus: 60, fstop: 4,
    cam: t => ({ pos: V(ST + 8 + 5.5, 1.6, 75), yaw: 5.2 * D2R, pitch: 1.4 * D2R }),
    weather: { dmin: 6.0, ground: 0, drift: true, count: 320000 },
    cast: [['L22_f27_black', 'row7', t => ({ pos: V(ST + 8.0, 0, 5.8), yaw: 0, tc: t - TL.act3 + 2.0, pingpong: true })],
           ['L06_f53_white', 'row7', t => ({ pos: V(ST + 9.2, 0, 5.3), yaw: -0.2, tc: t - TL.act3 + 4.1, pingpong: true })],
           ['L03_m38_asian', 'row7', t => ({ pos: V(ST + 6.8, 0, 5.2), yaw: 0.25, tc: t - TL.act3 + 0.6, pingpong: true })],
           ['L21_m32_black', 'walk7', t => ({ pos: V(ST + 4.5, 0, 46), yaw: Math.PI / 2, tc: t - 55.5 })]],
    pickup: t => { const u = Math.max(0, Math.min(1, (t - 57.6) / 3.6)), s = u * u * (3 - 2 * u), a = V(ST + 46, 0, 40), b = V(ST + 19, 0, 30), c = V(ST + 9.5, 0, 19.5);
      const p = a.clone().multiplyScalar((1 - s) ** 2).add(b.clone().multiplyScalar(2 * s * (1 - s))).add(c.clone().multiplyScalar(s * s)), d = b.clone().sub(a).multiplyScalar(2 * (1 - s)).add(c.clone().sub(b).multiplyScalar(2 * s));
      return { pos: p, yaw: Math.atan2(d.x, d.z), tail: 1, head: 1, visible: t > 57.4 }; } },
];
export function shotAt(t) { let s = SHOTS[0]; for (const x of SHOTS) if (t >= x.t0) s = x; return s; }
// the weather's swaps (w1..w7) map onto the shots in order; the action cuts are the plan's own
export const SWAP_SHOT = ['frame0', 'ontario', 'us', 'dark', 'houlton', 'glass', 'lot', 'site'];
export const CUT_LIST = CUTS;
// the crane's hook and the bundle (the site): the hook comes down 45.0-47.6 to the bundle, the slings go taut 48.2-48.52, it lifts
export function liftAt(t) {
  const down = Math.min(1, Math.max(0, (t - 44.6) / 3.0)), hookY = 14.0 - (14.0 - 2.4) * (down * down * (3 - 2 * down));
  const taut = Math.min(1, Math.max(0, (t - 48.15) / 0.37));
  const up = Math.max(0, t - TL.act1), lift = up <= 0 ? 0 : Math.min(6.2, 0.15 * up + 0.42 * up * up);
  return { hookY: hookY + lift, taut, lift };
}
// the tarp flap: pulled aside 51.95 -> 52.9 (the action carried across the cut at 52.27)
export const flapAt = t => { const u = Math.min(1, Math.max(0, (t - 51.95) / 0.95)); return u * u * (3 - 2 * u) * 1.75; };
