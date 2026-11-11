// RIG / GROUND (HUMAN studio, cycle 5): foot contact, world locks and stride from distance.
// After Kovar, Schreiner and Gleicher, "Footskate cleanup for motion capture editing" (SCA 2002): find the frames where a
// foot is on the ground, pin the contact point at its position at onset, solve the legs so the pin holds, and blend in and
// out of the pin instead of popping.
//   const fp = new FootPlant();                       one per foot, keeps state between frames (call in time order)
//   fp.update({ H, T, floor, dt, force })             H, T: the heel and toe points of the animated foot (rig space, m)
//        -> { planted, cp: 'H'|'T', pin: Vector3, off: Vector3, yaw, justPlanted, justReleased }
//   fp.release()   the caller could not reach the pin (a step): let go, blend out
//   phaseFromDistance(dist, step)   stride phase (radians, pi per step) from ground covered: amplitude and phase rate change
//        together, so a walk cannot skate when its speed or `amt` changes.
// Contact is decided from the animation's own foot heights (a hysteresis pair, plantH < liftH), never from a timer.
import * as THREE from 'three';

export class FootPlant {
  constructor({ plantH = 0.028, liftH = 0.05, blend = 0.11 } = {}) {
    Object.assign(this, { plantH, liftH, blend });
    this.planted = false; this.cp = 'H'; this.pin = new THREE.Vector3(); this.off = new THREE.Vector3(); this.yaw = 0; this.age = 0;
    this.justPlanted = false; this.justReleased = false; this._last = null;
  }
  reset() { this.planted = false; this.off.set(0, 0, 0); this._last = null; this.age = 0; }
  release() { if (!this.planted) return; this.planted = false; this.justReleased = true; this._rel = true; }
  // solved: where the solved foot's contact point currently is (for blending out), or null
  update({ H, T, floor, dt = 1 / 30, force = null, yaw = 0, solvedCp = null }) {
    this.justPlanted = this.justReleased = false;
    if (dt <= 0 || dt > 0.5) this.reset();                                  // a seek: forget the pin
    const hH = H.y - floor, hT = T.y - floor, minH = Math.min(hH, hT);
    if (!this.planted) {
      this.off.multiplyScalar(Math.exp(-dt / this.blend));
      if (force === 'free') return this;
      if (force === 'lock' || minH < this.plantH) {
        this.planted = true; this.justPlanted = true; this.age = 0; this.cp = hH <= hT ? 'H' : 'T';
        const c = this.cp === 'H' ? H : T; this.pin.set(c.x, floor, c.z); this.yaw = yaw;
        if (solvedCp) { this.pin.x = solvedCp.x; this.pin.z = solvedCp.z; }   // start where the foot really is: no pop
      }
      return this;
    }
    this.age += dt;
    if (force !== 'lock' && minH > this.liftH) { this.planted = false; this.justReleased = true; return this; }
    // heel-to-toe roll: the contact point moves to whichever end of the foot is lower (0.012 m hysteresis)
    const want = hH < hT - 0.012 ? 'H' : hT < hH - 0.012 ? 'T' : this.cp;
    if (want !== this.cp) {
      const a = this.cp === 'H' ? H : T, b = want === 'H' ? H : T;      // carry the pin along the rigid foot
      this.pin.x += b.x - a.x; this.pin.z += b.z - a.z; this.cp = want;
    }
    return this;
  }
}
// pi radians of stride phase per step; `step` is the step length in metres (the typed walk's is about 0.76 m x amt)
export const phaseFromDistance = (dist, step = 0.76) => dist * Math.PI / Math.max(0.1, step);
