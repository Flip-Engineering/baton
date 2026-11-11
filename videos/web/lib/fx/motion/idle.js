// MOTION / IDLE (MOTION studio, cycle 1): standing as a sequence of events, not a shared oscillator.
// Measured prolonged standing (Duarte and Zatsiorsky, Motor Control 3, 1999) is not periodic: the centre of pressure SHIFTS
// (a fast, step-like transfer of weight from one foot to the other), FIDGETS (a short pulse out and back) and DRIFTS (a slow
// ramp), at irregular intervals of seconds to tens of seconds, on top of a ~0.2 Hz sway of a few millimetres. Perlin's Improv
// (1996) layered band-limited noise on authored motion; here the noise is only the sway band and everything else is an event
// with its own time, size and duration, drawn from the figure's seed. Two figures never share a frequency, and nothing is a sine
// of t shared with a neighbour. Pure function of (t, seed): seekable, no state.
//
//   const I = new Idle({ seed, posture: 'hang' | 'belt' | 'fold' | 'back' | 'loose' | null, exertion: 0..1, restless: 0..1 })
//   I.sample(t) -> { weight (-1 left .. 1 right foot... + = left), sway: [x, z] m, dip m, hipYaw, chestYaw, slump, headPitch, look (yaw), lookPitch,
//                    breath (-1..1), arms: [L, R] Euler sets for Poser.arms, events: { shift, fidget, glance } (the one in progress) }
import { hash, noise1, fbm, clamp, smoother, lerp } from './poser.js';

export const POSTURES = {
  hang:  { ua: [0.03, 0, 0.07], fa: [-0.16, 0, 0], hn: [0.05, 0, 0], curl: 0.4 },
  loose: { ua: [-0.05, 0, 0.1], fa: [-0.38, 0, 0], hn: [0.2, 0, 0], curl: 1.0 },
  belt:  { ua: [0.25, -0.35, 0.16], fa: [-1.05, 0, 0], hn: [0.1, 0, 0], curl: 0.9 },
  fold:  { ua: [-0.3, -0.95, 0.16], fa: [-1.95, 0, 0], hn: [0.1, 0, 0], curl: 0.7 },
  back:  { ua: [0.38, -1.1, 0.12], fa: [-1.1, 0, 0], hn: [0.1, 0, 0], curl: 0.8 },
};
const NAMES = ['hang', 'hang', 'loose', 'belt', 'fold', 'back'];
const lerpArm = (a, b, u) => ({ ua: a.ua.map((x, i) => lerp(x, b.ua[i], u)), fa: a.fa.map((x, i) => lerp(x, b.fa[i], u)), hn: a.hn.map((x, i) => lerp(x, b.hn[i], u)), curl: lerp(a.curl, b.curl, u) });

export class Idle {
  // HUMAN c8 lane F (opt-in): kin = a person's kinematic model: quiet-stance sway grows with age and body mass (the direction of the
  // posturography literature; the factors, 1 + 0.8 x age past 30 over 50 y and 1 + 0.4 x BMI past 25 over 15, are OUR assumption), the
  // breathing rate a little faster for an older or heavier body; without kin nothing changes
  constructor({ seed = 1, posture = null, exertion = 0, restless = 0.5, gaze = 1, kin = null } = {}) {
    this.seed = seed; this.exertion = exertion; this.restless = restless; this.gaze = gaze;
    const r = k => hash(seed * 7 + 3, k);
    this.posture0 = posture || NAMES[Math.floor(r(1) * NAMES.length)];
    this.swayF = 0.14 + 0.14 * r(2); this.swayA = 0.003 + 0.004 * r(3); this.breathF = (12 + 6 * r(4)) / 60; this.lookBias = (r(5) - 0.5) * 0.3;
    if (kin) { const old = clamp((kin.age - 30) / 50), bmi = kin.mass / (kin.stature * kin.stature), heavy = clamp((bmi - 25) / 15);
      this.swayA *= (1 + 0.8 * old) * (1 + 0.4 * heavy); this.breathF *= 1 + 0.1 * old + 0.1 * heavy; this.kin = true; }
    this._ev = { shift: [], fidget: [], glance: [], posture: [] };
  }
  // events of one kind up to time t: [{ t, d, ...}] with intervals drawn per kind (log-uniform between lo and hi seconds)
  _events(kind, t, lo, hi, mk) {
    const L = this._ev[kind], salt = { shift: 11, fidget: 23, glance: 37, posture: 51 }[kind];
    let last = L.length ? L[L.length - 1].t : -hash(this.seed, salt) * hi;
    while (last <= t + hi) { const i = L.length, u = hash(this.seed * 131 + i, salt); last += lo * Math.pow(hi / lo, u); L.push({ t: last, i, ...mk(i, k => hash(this.seed * 977 + i * 13 + k, salt)) }); }
    return L;
  }
  _at(L, t) { let a = null; for (const e of L) { if (e.t > t) break; a = e; } return a; }
  sample(t) {
    const R = this.restless, ex = this.exertion;
    // SHIFT: the weight moves to the other foot (mostly) in 0.5-1.2 s, every 4-30 s (more often when restless or tired)
    const S = this._events('shift', t, 4 / (0.5 + R), 30 / (0.5 + R), (i, r) => ({ w: (i % 2 ? 1 : -1) * (r(1) < 0.15 ? -0.3 : 1) * (0.45 + 0.5 * r(2)), d: 0.5 + 0.7 * r(3) }));
    let weight = 0; { const e = this._at(S, t); if (e) { const prev = e.i > 0 ? S[e.i - 1].w : 0; weight = lerp(prev, e.w, smoother((t - e.t) / e.d)); } }
    // FIDGET: a pulse out and back (hip, shoulders, a hand to the face, a heel), 0.4-1.0 s, every 3-20 s
    const Fg = this._events('fidget', t, 3 / (0.4 + R), 20 / (0.4 + R), (i, r) => ({ kind: Math.floor(r(1) * 4), a: (r(2) - 0.5) * 2, d: 0.4 + 0.6 * r(3) }));
    let fx = 0, fz = 0, fyaw = 0, fsh = 0; const fe = this._at(Fg, t);
    if (fe && t - fe.t < fe.d) { const u = (t - fe.t) / fe.d, p = Math.sin(Math.PI * u) ** 2;
      if (fe.kind === 0) fx = 0.012 * fe.a * p; else if (fe.kind === 1) fz = 0.01 * fe.a * p; else if (fe.kind === 2) fyaw = 0.12 * fe.a * p; else fsh = 0.06 * Math.abs(fe.a) * p; }
    // GLANCE: the eyes go, the head follows; a hold of 0.6-3 s; every 2-14 s
    const G = this._events('glance', t, 2, 14, (i, r) => ({ yaw: (r(1) - 0.5) * 2 * (0.25 + 0.75 * r(2)) * this.gaze, pitch: (r(3) - 0.6) * 0.3, d: 0.6 + 2.4 * r(4) }));
    let look = this.lookBias, lookPitch = 0, chestLook = 0; const g = this._at(G, t);
    if (g) { const tin = 0.22, tout = 0.4, a = t - g.t, w = a < tin ? smoother(a / tin) : a < tin + g.d ? 1 : 1 - smoother((a - tin - g.d) / tout);
      look += g.yaw * Math.max(0, w); lookPitch = g.pitch * Math.max(0, w);
      const ac = a - 0.18, wc = ac < 0 ? 0 : ac < tin * 1.6 ? smoother(ac / (tin * 1.6)) : ac < tin + g.d ? 1 : 1 - smoother((ac - tin - g.d) / (tout * 1.5)); chestLook = g.yaw * 0.3 * Math.max(0, wc); look -= chestLook; }
    // DRIFT + SWAY: a slow ramp and the ~0.2 Hz band, each figure on its own frequency
    const sx = this.swayA * noise1(t * this.swayF * 2, this.seed + 1) + 0.006 * fbm(t * 0.05, this.seed + 2), sz = this.swayA * 1.3 * noise1(t * this.swayF * 2.3, this.seed + 3) + 0.008 * fbm(t * 0.04, this.seed + 4);
    // BREATH: own rate, irregular, deeper and faster after effort
    const rate = this.breathF * (1 + 1.2 * ex), ph = 2 * Math.PI * (t * rate + 0.6 * fbm(t * 0.07, this.seed + 5)), breath = Math.sin(ph) * (0.6 + 0.8 * ex);
    // POSTURE of the arms: changes rarely (20-70 s), with a 0.9 s transition
    const P = this._events('posture', t, 20, 70, (i, r) => ({ name: r(1) < 0.55 ? this.posture0 : NAMES[Math.floor(r(2) * NAMES.length)] }));
    let arm = POSTURES[this.posture0]; const pe = this._at(P, t);
    if (pe) { const prev = POSTURES[pe.i > 0 ? P[pe.i - 1].name : this.posture0], cur = POSTURES[pe.name]; arm = lerpArm(prev, cur, smoother((t - pe.t) / 0.9)); }
    const arms = [0, 1].map(k => { const a = { ua: arm.ua.slice(), fa: arm.fa.slice(), hn: arm.hn.slice(), curl: arm.curl };
      a.ua[0] += 0.04 * noise1(t * 0.3, this.seed + 10 + k) + (k ? -1 : 1) * 0.02 * weight; a.fa[0] += 0.05 * noise1(t * 0.23, this.seed + 20 + k) - 0.03 * breath * 0.3; a.ua[2] += fsh * 0.3; return a; });
    return { weight, sway: [sx + fx, sz + fz], dip: 0.006 * Math.abs(weight) + 0.004 * ex, hipYaw: -0.06 * weight + fyaw * 0.5, chestYaw: chestLook + fyaw * 0.3, slump: 0.02 * ex + 0.01 * fbm(t * 0.03, this.seed + 6),
      headPitch: lookPitch + 0.03 * noise1(t * 0.2, this.seed + 7), look, lookPitch, breath, arms, shrug: fsh };
  }
}
