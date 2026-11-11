// DEAD LABOUR v2: the class. People from the person pipeline (lib/fx/people.js draws every figure as a person of the current crowd bake,
// assets/person/crowd/: the twelve lineup people, women and men of every background, re-rigged at their own size and joints), each figure
// cast from its own body (ANSUR II via workforce.workerDesc: stature, build, age), dressed for a cold night in the city in their own
// colours: coats, jackets, jeans; a few knit hats and caps; no job costumes.
//   ~21.6 on    a few dozen come out of the cross street and turn down the avenue toward the deposit
//   ~20.5-29.8  ~430 walk into the plaza from the side streets, from the far side and from behind the lens, in twos and threes and alone,
//               and stand close in clumps, never a grid; once there they turn to it and look up
//   ~33-39      a few raise a fist (people.js PUMP: bent at the elbow), late and not together, as the light runs home over them
// They are lit by the city (sodium from the plaza's lamps behind them), and by the cold of what the deposit holds while it holds it.
import * as THREE from 'three';
import { People } from '../lib/fx/people.js';
import { workerDesc } from '../lib/fx/workforce.js';
import { mulberry32 } from '../lib/fx/rig/body.js';
import { TL, DEP, crowdPlan, crowdAt, streetPlan, streetAt } from './deadlabour.plan.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const TOPS = ['#2b2f36', '#3a3f47', '#4a3b2f', '#2f3a2c', '#6b2a24', '#1f2a3d', '#3d2f3a', '#555a60', '#283848', '#45302a', '#5a2e2e', '#2e4a4a', '#3c3c3c', '#4a5a3a', '#2a3550', '#6a6e74'];   // no tans or beiges: at night they read as skin
const BOTS = ['#1c1f26', '#2a2d33', '#34465e', '#2e2a26', '#4a4038', '#3a3f4a', '#232323', '#465a72', '#5a5246'];
const HATS = ['#2a2a2e', '#5a2a24', '#3a4250', '#6a6050', '#1e2a36'];

export function buildCrowd({ scene, ansur, viewH }) {
  const R = mulberry32(1917), P = crowdPlan(), S = streetPlan();
  const folk = new People(scene, { max: P.length + S.length + 4, viewH, budget: [120, 520], lodPx: [180, 64], shadows: 'none' });
  const dress = () => {
    const hat = R() < 0.16, trade = hat ? (R() < 0.65 ? 'weld' : 'farm') : ['farm', 'rail', 'overalls', 'weld'][Math.floor(R() * 4)];
    const d = workerDesc(ansur, R, { c7: true, trade, women: 0.48 });
    d.top = TOPS[Math.floor(R() * TOPS.length)]; d.bottom = BOTS[Math.floor(R() * BOTS.length)]; d.hat = hat; d.hatColor = HATS[Math.floor(R() * HATS.length)];
    d.accent = d.top; d.noVest = true; d.gloves = false; d.prop = false; d.dirt = 0.05; d.wear = 0.15;
    return d;
  };
  for (const p of P) p.id = folk.add(dress());
  for (const w of S) w.id = folk.add(dress());
  // the light on them (people.js is not lit by the LightField): the city's sodium from the plaza's lamps behind them, a cold wash from what
  // the crown holds, a dim sky
  const city = new THREE.SpotLight('#ffb470', 0, 260, 0.9, 0.7, 2); city.position.set(0, 34, 196); city.target.position.set(0, 0, 70); scene.add(city, city.target);
  const street = new THREE.SpotLight('#ffb470', 0, 140, 1.0, 0.8, 2); street.position.set(-40, 26, 226); street.target.position.set(-30, 0, 200); scene.add(street, street.target);
  const cold = new THREE.SpotLight('#cfd6d0', 0, 420, 0.5, 0.8, 2); cold.position.set(0, 270, 30); cold.target.position.set(0, 0, 80); scene.add(cold, cold.target);
  // heads up to it once they stand (people.js: a negative head pitch looks up), the idle glances damped
  const lookUp = (out, st, api) => { const h = api.B.head * 3, n = api.B.neck * 3, k = st.upK || 0;
    out[h + 1] *= 1 - 0.7 * k; out[h] += -0.3 * k + (st.lookJ || 0) * 0.12 * k; out[n] += -0.1 * k; };
  const FR = new THREE.Frustum(), PV = new THREE.Matrix4(), SPH = new THREE.Sphere(new THREE.Vector3(), 2.2);

  function pose(t, cam, shot, { held = 0, back = 0 } = {}) {
    const mark = shot === 'mark';
    FR.setFromProjectionMatrix(PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const p of P) {
      if (mark || t < p.t0) { folk.set(p.id, { visible: false }); continue; }
      const c = crowdAt(p, t);
      SPH.center.set(c.x, 1, c.z); if (!FR.intersectsSphere(SPH)) { folk.set(p.id, { visible: false }); continue; }
      const up = sstep(p.arrive + 0.6, p.arrive + 2.0, t), r = p.raise != null ? sstep(p.raise, p.raise + 0.9, t) : 0;
      const sw = c.walking ? 1 : sstep(p.arrive + 0.5, p.arrive, t);           // the last step settles into standing
      folk.set(p.id, { visible: true, x: c.x, y: 0, z: c.z, heading: c.heading, t: t + p.ph, upK: up, lookJ: (p.lag - 0.5) * 0.6, pose: lookUp,
        act: sw > 0.5 ? 'walk' : 'stand', ph: c.d * 4.15 + p.ph, amt: 0.85, speed: p.speed, mix: sw > 0 && sw < 1 ? { walk: sw, stand: 1 - sw } : null,
        gesture: r > 0 ? { name: 'PUMP', side: p.i % 2 ? -1 : 1, w: r, p: 0.85 + 0.15 * Math.sin((t + p.ph) * 1.7) } : null, pump: null });
    }
    for (const w of S) {
      if (mark || t < TL.street) { folk.set(w.id, { visible: false }); continue; }
      const c = streetAt(w, t);
      SPH.center.set(c.x, 1, c.z); if (!FR.intersectsSphere(SPH)) { folk.set(w.id, { visible: false }); continue; }
      folk.set(w.id, { visible: true, x: c.x, y: 0, z: c.z, heading: c.walking ? c.heading : Math.PI, t: t + w.ph, upK: c.walking ? 0 : 0.6, lookJ: 0, pose: lookUp,
        act: c.walking ? 'walk' : 'stand', ph: c.d * 4.15 + w.ph, amt: 0.85, speed: w.speed, mix: null, gesture: null, pump: null });
    }
    folk.update(cam);
    const on = !mark;
    city.intensity = on ? 16000 * (0.55 + 0.45 * back) : 0;
    street.intensity = on ? 900 : 0;
    cold.intensity = on ? 52000 * held : 0;
  }
  return { folk, P, S, pose, lights: { city, street, cold } };
}
