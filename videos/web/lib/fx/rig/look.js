// RIG / LOOK (HUMAN studio, cycle 5): eyes lead, then head, neck and chest follow, each later and slower.
// Animation's cascade: the eyes arrive first, the head follows a few frames behind, the shoulders last; a head that turns
// alone reads as a turret. The turn is shared 50 / 30 / 20 across head / neck / chest, each stage clamped to its own range
// (the head cannot turn 90 degrees, so the neck and chest take what it can't).
//   const lk = new LookCascade();  lk.update({ yaw, pitch, dt })   yaw/pitch = where the target is from the chest, radians
//   -> { eyes:{yaw,pitch}, head, neck, chest }  angles to ADD to each bone (yaw about up, pitch about the lateral axis)
export class LookCascade {
  constructor({ share = { head: 0.5, neck: 0.3, chest: 0.2 }, tau = { eyes: 0.045, head: 0.11, neck: 0.16, chest: 0.24 }, lim = { head: 0.7, neck: 0.85, chest: 0.5, eyes: 0.6 } } = {}) {
    Object.assign(this, { share, tau, lim }); this.s = { eyes: [0, 0], head: [0, 0], neck: [0, 0], chest: [0, 0] }; this.first = true;
  }
  reset() { this.first = true; }
  update({ yaw = 0, pitch = 0, dt = 1 / 30, weight = 1 }) {
    yaw *= weight; pitch *= weight;
    // targets per stage; what the head can't take goes to the neck, then the chest
    const T = { chest: [0, 0], neck: [0, 0], head: [0, 0], eyes: [0, 0] };
    for (const k of [0, 1]) {
      const v = k ? pitch : yaw, cap = k ? 0.5 : 1;
      let r = v;
      const c = Math.max(-this.lim.chest * cap, Math.min(this.lim.chest * cap, v * this.share.chest)); T.chest[k] = c; r -= c;
      const n = Math.max(-this.lim.neck * cap * 0.6, Math.min(this.lim.neck * cap * 0.6, v * this.share.neck)); T.neck[k] = n; r -= n;
      const h = Math.max(-this.lim.head * cap, Math.min(this.lim.head * cap, r)); T.head[k] = h; r -= h;
      T.eyes[k] = Math.max(-this.lim.eyes, Math.min(this.lim.eyes, r + (v - T.chest[k] - T.neck[k] - T.head[k]) * 0));  // leftover to the eyes
    }
    for (const st of ['eyes', 'head', 'neck', 'chest']) {
      const a = this.first ? 1 : 1 - Math.exp(-dt / this.tau[st]);
      // the eyes lead: they aim at the full target and settle as the head arrives (so the eye lead shrinks)
      for (const k of [0, 1]) this.s[st][k] += (T[st][k] - this.s[st][k]) * a;
    }
    this.first = false;
    const o = st => ({ yaw: this.s[st][0], pitch: this.s[st][1] });
    return { eyes: o('eyes'), head: o('head'), neck: o('neck'), chest: o('chest') };
  }
}
