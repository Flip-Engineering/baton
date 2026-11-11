// ART kit / MOTION: the house motion grammar. Things STRIKE, LAND and SETTLE. Pure functions of t (seconds), output
// quantised to frames so a still at t equals the same frame of a render. Figures and effects on twos, camera on ones.
//
//   import { M } from '../lib/fx/art/motion.js';
//   M.twos(t)                         -> t snapped to every other frame (figures, effects, prints)
//   M.strike(t, hitT, {pre})          -> { phase: 'wait'|'wind'|'contact'|'settle'|'rest', s, y, f }
//        wind: 3-5 frames of pull-back before the hit (s: scale 1 -> 1+pull), contact on frame ceil(hitT*30)
//   M.land(t, hitT)                   -> { squash, spread, overshoot, f }: 2-frame squash, 6-10 frame settle, <=3% overshoot
//   M.drift(t, seed)                  -> [dx, dy] sub-beat micro motion for holds (two incommensurate periods)
//   M.shake(t, hitT, amp)             -> [dx, dy] a struck-plate kick: one hard frame, decaying on twos
export const FPS = 30;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const frameOf = t => Math.round(t * FPS + 1e-6);
export const hitFrame = hitT => Math.ceil(hitT * FPS - 1e-6);

export const M = {
  FPS, frameOf, hitFrame,
  twos: t => Math.floor(frameOf(t) / 2) * 2 / FPS,
  threes: t => Math.floor(frameOf(t) / 3) * 3 / FPS,
  // frames since the hit's contact frame (negative before it)
  rel: (t, hitT) => frameOf(t) - hitFrame(hitT),
  strike(t, hitT, { pre = 4, pull = 0.06, lift = 0 } = {}) {
    const f = this.rel(t, hitT);
    if (f < -pre) return { phase: 'wait', s: 1, y: 0, f };
    if (f < 0) { const u = (f + pre + 1) / (pre + 1); const e = u * u * (3 - 2 * u); return { phase: 'wind', s: 1 + pull * e, y: -lift * e, f }; }
    if (f === 0) return { phase: 'contact', s: 1, y: 0, f };
    if (f <= 10) return { phase: 'settle', s: 1, y: 0, f };
    return { phase: 'rest', s: 1, y: 0, f };
  },
  // squash on contact (dot gain / deformation), spread = ink squeezed out, overshoot a damped 1-cycle ring
  land(t, hitT, { squash = 0.06, settle = 8, over = 0.03 } = {}) {
    const f = this.rel(t, hitT);
    if (f < 0) return { squash: 0, spread: 0, overshoot: 0, f };
    const sq = f === 0 ? squash : f === 1 ? squash * 0.45 : 0;
    const u = clamp(f / settle), ov = f >= 2 ? over * Math.sin(Math.PI * clamp((f - 2) / (settle - 2))) * (1 - u) : 0;
    return { squash: sq, spread: f <= 1 ? 1 - f * 0.4 : Math.max(0, 0.6 - 0.1 * (f - 1)), overshoot: ov, f };
  },
  // an entry: from `from` (scale) to 1 over n frames, with the strike's wind-up reversed (fast in, hard stop)
  enter(t, hitT, { from = 1.16, n = 3 } = {}) {
    const f = this.rel(t, hitT);
    if (f < -n) return { s: from, a: 0 };
    if (f < 0) { const u = (f + n + 1) / (n + 1); return { s: from + (1 - from) * u * u, a: 1 }; }
    return { s: 1, a: 1 };
  },
  drift(t, seed = 1, amp = 3) {
    const tt = this.twos(t), a = seed * 1.7;
    return [amp * (Math.sin(tt * 1.3 + a) + 0.5 * Math.sin(tt * 3.1 + a * 2.3)), amp * 0.6 * (Math.sin(tt * 1.7 + a * 0.7) + 0.4 * Math.sin(tt * 2.9 + a))];
  },
  shake(t, hitT, amp = 14, seed = 3) {
    const f = this.rel(t, hitT); if (f < 0 || f > 9) return [0, 0];
    const k = Math.floor(f / 2) * 2, d = amp * Math.pow(0.55, k / 2), s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    const r = s - Math.floor(s); return [d * Math.cos(r * 6.283), d * Math.sin(r * 6.283) * 0.6];
  },
  // named curves (0..1 -> 0..1) for anything that is not a strike: 'press' (slow-fast-stop), 'lift' (fast off the
  // paper then slow), 'pour' (accelerating fall, g), 'whip' (overshooting cloth)
  curve: {
    press: u => { u = clamp(u); return u < 0.6 ? 0.25 * (u / 0.6) ** 2 : 0.25 + 0.75 * (1 - (1 - (u - 0.6) / 0.4) ** 3); },
    lift: u => 1 - (1 - clamp(u)) ** 4,
    pour: u => clamp(u) ** 2,
    whip: u => { u = clamp(u); return 1 - Math.exp(-6 * u) * Math.cos(9 * u); },
  },
};
