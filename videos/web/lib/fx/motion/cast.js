// MOTION / CAST (MOTION studio, cycle 1): the glue between the motion layer and people.js.
// A figure driven by this folder gets its whole pose from the Poser (the act's intents solved to Euler numbers), placed with
// st.plant = false so people.js does not re-plant it (the feet are already where the act put them), and no c5 rig on top.
//
//   const C = new Cast(folk);
//   C.sc(id)                                   the figure's instance scale (people.js: d.h / bind stature)
//   C.dims(id)                                 Poser.dims() for its body
//   C.apply(id, frame, spec, t)                -> rep  (Poser report, world joints), then folk.update(camera) as usual
//   C.walker(id, opts)                         a steps.js Walker sized to this figure (stature, legs, body mass, age)
import { Poser } from './poser.js';
import { Walker } from './steps.js';

const COPY = (out, st) => { if (st._mz) out.set(st._mz); };
export class Cast {
  constructor(folk) { this.folk = folk; this.poser = new Poser(); }
  sc(id) { const st = this.folk.get(id); return st.d.h / (st._H0 || 1.78); }
  dims(id) { const st = this.folk.get(id); this.poser.begin(st._mz || (st._mz = new Float32Array(66)), st); return this.poser.dims(); }
  bodyKg(id) { const d = this.folk.get(id).d; const m = d._ansur && /(\d+) kg/.exec(d._ansur); if (m) return +m[1]; return (d.fem ? 64 : 80) * (0.85 + 0.5 * (d.heavy ?? 0.3)) * (d.h / 1.76) ** 2; }
  walker(id, o = {}) { const st = this.folk.get(id), d = st.d, g = d.gait || {};
    return new Walker({ seed: (d.seed || id + 1) * 7 + id, h: d.h, dims: this.dims(id), sc: this.sc(id), speed: g.speed ? Math.min(1.6, g.speed) : 1.3, swing: g.swing ?? 1, age: d.age || 0, bodyKg: this.bodyKg(id), ...o }); }
  apply(id, frame, spec, t = 0, extra = {}) {
    const st = this.folk.get(id), Pz = st._mz || (st._mz = new Float32Array(66));
    this.poser.begin(Pz, st); const rep = this.poser.solve(Pz, spec, frame);
    this.folk.set(id, { x: frame.pos.x, y: frame.pos.y, z: frame.pos.z, heading: frame.heading, act: 'stand', plant: false, lift: 0, rig: null, mix: null, gesture: null, look: 0, pose: COPY, t, ...extra });
    return rep;
  }
}
