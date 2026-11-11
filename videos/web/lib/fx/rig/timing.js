// RIG / TIMING (HUMAN studio, cycle 5): acting as keyed poses with a contact frame locked to a world event.
// Richard Williams' order (Animator's Survival Kit): contact first, then anticipation, the down that carries the weight, the
// passing position, the up. A tween between two poses is not an action. Keys are strong poses; playback holds them
// (Guilty Gear Xrd: hand-keyed stepped timing reads as drawn, a floored smooth clip reads as a stutter).
//   const swing = new Keyed([{ t: 0, v: { arm: 0 } }, { t: .5, v: { arm: 1 }, name: 'top', ease: 'out' }, { t: .62, v: { arm: -.2 }, name: 'contact', ease: 'in' }, ...]);
//   swing.sample(t)                         -> { arm, ... } smooth (ease per segment: in, out, inout, hold, over)
//   swing.sample(t, { stepped: 12 })        -> the keys, held on a 12 fps grid, but a key time always lands exactly
//   swing.lockContact('contact', worldT)    -> a copy shifted so the contact key lands on the world event's time
//   swing.at('contact')                     -> time of a named key
// Ease pairs, not smoothstep: `in` accelerates into the key (a drop), `out` decelerates into it (a wind-up top), `over`
// overshoots by 8 % and settles (follow-through, drag on a tool or the head).
const E = {
  lin: u => u, hold: u => (u >= 1 ? 1 : 0), in: u => u * u * u, out: u => 1 - Math.pow(1 - u, 3), inout: u => u * u * (3 - 2 * u),
  over: u => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); },
};
export class Keyed {
  constructor(keys) { this.keys = keys.slice().sort((a, b) => a.t - b.t); this.names = {}; for (const k of this.keys) if (k.name) this.names[k.name] = k.t; this.duration = this.keys[this.keys.length - 1].t; }
  at(name) { return this.names[name]; }
  lockContact(name, worldT) { const d = worldT - this.names[name]; return new Keyed(this.keys.map(k => ({ ...k, t: k.t + d }))); }
  sample(t, { stepped = 0 } = {}) {
    const K = this.keys;
    if (stepped) { const g = Math.floor(t * stepped + 1e-9) / stepped; let kt = -Infinity; for (const k of K) if (k.t <= t + 1e-9 && k.t > kt) kt = k.t; t = Math.max(g, kt); }
    if (t <= K[0].t) return { ...K[0].v }; if (t >= K[K.length - 1].t) return { ...K[K.length - 1].v };
    let i = 0; while (i < K.length - 2 && t >= K[i + 1].t) i++;
    const a = K[i], b = K[i + 1], u = (t - a.t) / (b.t - a.t), f = (E[b.ease || 'inout'] || E.inout)(u), out = {};
    for (const c in a.v) out[c] = a.v[c] + (b.v[c] - a.v[c]) * f;
    return out;
  }
}
// a drag/overlap follower: value chases its driver with a lag of `frames` at 30 fps (a head or a tool that arrives late)
export function follow(state, target, dt, frames = 3) { const a = 1 - Math.exp(-dt * 30 / Math.max(0.5, frames)); return state + (target - state) * a; }
