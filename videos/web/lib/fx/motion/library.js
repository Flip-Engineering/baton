// MOTION / LIBRARY (MOTION studio, cycle 1): the baked motion takes (assets/motion/cmu/*.mot + library.json) and how a cast uses them.
// RIG c1's walkStyle() picked a take uniformly WITH replacement and time-stretched it up to 1.7x to hit a Froude speed, so four of
// eight workers walked as one man, sped up. Here takes are dealt WITHOUT replacement, each body gets the take whose natural speed
// (per leg length) is closest to its own, and the playback rate stays within +-15 % (people walk faster by lengthening the stride,
// not by speeding the clock); what the take cannot cover is reported, not hidden.
//
//   const L = await loadLibrary(base)                  base: URL of assets/motion/cmu/ (with the trailing slash)
//   L.find({ act: 'carry' }) -> [meta]                 tags: act, therbligs, kg (CMU's measured suitcase weights), tool
//   const clip = await L.clip('70_03')                 a MotionClip (clipfmt.js): people.js plays it as act 'clip'
//   castTakes(bodies, L.find({ act: 'walk' }), { maxWarp: 0.15 }) -> [{ id, rate, warpMiss }]   bodies: [{ speed, leg }]
import { loadMotion } from './clipfmt.js';

export async function loadLibrary(base) {
  const idx = await (await fetch(base + 'library.json')).json(), cache = new Map();
  return {
    index: idx, takes: idx.takes,
    find(q = {}) { return Object.values(idx.takes).filter(t => Object.entries(q).every(([k, v]) => k === 'therblig' ? (t.therbligs || []).includes(v) : t[k] === v)); },
    async clip(id) { if (!cache.has(id)) cache.set(id, loadMotion(base + id + '.mot')); return cache.get(id); },
  };
}
// deal takes to bodies: greedy on the cost |log(want / natural)|, each take used once until all are used (then a second round)
export function castTakes(bodies, takes, { maxWarp = 0.15, legRef = 0.84 } = {}) {
  const out = new Array(bodies.length), free = new Set(takes.map((_, i) => i)), order = bodies.map((b, i) => i).sort((a, b) => bodies[b].speed - bodies[a].speed);
  for (const i of order) {
    if (!free.size) takes.forEach((_, k) => free.add(k));
    const b = bodies[i]; let best = -1, bc = Infinity;
    for (const k of free) { const nat = (takes[k].speed || 1.3) * (b.leg || legRef) / legRef, c = Math.abs(Math.log(b.speed / nat)); if (c < bc) { bc = c; best = k; } }
    free.delete(best); const nat = (takes[best].speed || 1.3) * (b.leg || legRef) / legRef, want = b.speed / nat, rate = Math.min(1 + maxWarp, Math.max(1 - maxWarp, want));
    out[i] = { id: takes[best].id, rate: +rate.toFixed(3), warpMiss: +(want / rate - 1).toFixed(3) };   // warpMiss != 0: this body walks at the take's pace, not its wish
  }
  return out;
}
