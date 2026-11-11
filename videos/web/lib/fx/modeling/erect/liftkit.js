// ERECT liftkit (MODELING c5): the build as a few long holds, with cranes that slew at a real rate and loads that swing.
//
// Why (c4 judge, c5 critic): c4's time-lapse was ~90 snapped lifts: each hook lerped 65% of the way to its target every frame, so the
// jibs snapped, and in a held build state members hung at drop height with no hook. Durandelle's Eiffel series is a few frames, each
// a different state and each a composed photograph. So: a HOLD is a fixed build state with ONE lift seen landing: the crane slews
// in at ~5-6 deg/s and decelerates, the trolley runs in, the hoist lowers, the load hangs on its rope as a pendulum driven by the
// trolley's acceleration (so it swings when the jib stops), two tag lines run down to the men steering it, and it seats in place.
//
// The lift itself is the giant's own steel: extractLift() copies the triangles of one erection bucket (same threshold, one side)
// out of the merged segment mesh into a mesh of its own (same material, always visible, no drop), parented where the original is,
// so it can be flown and then sits exactly where the original will be.
//
//   const L = extractLift(E, thr, side);  L.place(worldCentre);  L.dispose()
//   const H = new BuildHolds(E, Y, scene, cranes, [{ u: .34, dur: 2.5, crane: 0 }, ...]);  H.update(t)  (cut times: H.cuts)
import * as THREE from 'three';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, t) => { const u = clamp((t - a) / (b - a)); return u * u * (3 - 2 * u); };
const d2r = Math.PI / 180, G = 9.81;

// copy one erection bucket out of the giant's merged meshes. side: +1 / -1 (by the triangle's rest x for centre batches), 0 = both
export function extractLift(E, thr, side = 0, { eps = 2e-5 } = {}) {
  E.g.updateMatrixWorld(true); const inv = E.g.matrixWorld.clone().invert(), out = [], v = V3(), c = V3(); let nv = 0;
  for (const B of E.batches) { const grp = B.group; if (!grp) continue;
    if (side && B.side && B.side !== side) continue;
    grp.traverse(m => { if (!m.isMesh || !m.geometry.attributes.aStage || m.geometry.index) return; const g = m.geometry, st = g.attributes.aStage, P = g.attributes.position, n = P.count;
      const keep = [], M = inv.clone().multiply(m.matrixWorld);
      for (let i = 0; i < n; i += 3) { if (Math.abs(st.getX(i) - thr) > eps) continue;
        if (side && !B.side) { c.set(0, 0, 0); for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(P, i + k)); c.multiplyScalar(1 / 3).applyMatrix4(M); if ((c.x >= 0 ? 1 : -1) !== side) continue; }
        keep.push(i); }
      if (!keep.length) return;
      const ng = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(g.attributes)) { const sz = a.itemSize, arr = new a.array.constructor(keep.length * 3 * sz); keep.forEach((i, j) => arr.set(a.array.subarray(i * sz, (i + 3) * sz), j * 3 * sz)); ng.setAttribute(name, new THREE.BufferAttribute(arr, sz, a.normalized)); }
      const s2 = ng.attributes.aStage; for (let i = 0; i < s2.count; i++) { s2.setX(i, 0); s2.setW(i, 0); }
      ng.computeBoundingSphere(); ng.computeBoundingBox();
      const mm = new THREE.Mesh(ng, m.material); mm.castShadow = m.castShadow; mm.receiveShadow = m.receiveShadow; if (m.customDepthMaterial) mm.customDepthMaterial = m.customDepthMaterial;
      mm.position.copy(m.position); mm.quaternion.copy(m.quaternion); mm.scale.copy(m.scale); m.parent.add(mm); out.push(mm); mm.userData.seg = B; nv += keep.length * 3; });
  }
  // one bucket can hold pieces of two segments (a beam panel and a shin plate share a threshold): a crane carries one, so keep
  // only the segment with the most steel in the bucket
  { const cnt = new Map(); for (const m of out) cnt.set(m.userData.seg, (cnt.get(m.userData.seg) || 0) + m.geometry.attributes.position.count);
    const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (let i = out.length - 1; i >= 0; i--) if (out[i].userData.seg !== best) { out[i].removeFromParent(); out[i].geometry.dispose(); out.splice(i, 1); } }
  const box = new THREE.Box3(); for (const m of out) { m.updateMatrixWorld(true); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
  const seat = box.getCenter(V3()), size = box.getSize(V3()), base = out.map(m => m.position.clone());
  return { meshes: out, seat, size, box, n: nv,
    // fly it: its centre at world point p (a lift hangs level on its slings, so the meshes keep their orientation)
    place(p) { const d = p.clone().sub(seat); out.forEach((m, i) => { const q = m.parent.getWorldQuaternion(new THREE.Quaternion()).invert(), ps = m.parent.getWorldScale(V3()); m.position.copy(base[i]).add(d.clone().applyQuaternion(q).divide(ps)); m.updateMatrixWorld(true); }); },
    dispose() { out.forEach(m => { m.removeFromParent(); m.geometry.dispose(); }); } };
}

// a rope or line drawn between two world points (a thin cylinder, re-aimed per frame)
function line(scene, r, col = '#1b1b1b') { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 5), new THREE.MeshStandardMaterial({ color: col, roughness: .7 })); m.castShadow = true; scene.add(m); return m; }
function aim(m, a, b) { const d = b.clone().sub(a), L = d.length(); m.position.copy(a).addScaledVector(d, .5); m.scale.set(1, Math.max(.01, L), 1); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); }

// one tower crane driven by slew angle, trolley radius and hook height; the hook block hangs off the trolley with a swing offset
export class CraneDrive {
  constructor(scene, Cr) {
    this.scene = scene; this.Cr = Cr; this.slings = [0, 1, 2, 3].map(() => line(scene, .045)); this.tags = [0, 1].map(() => line(scene, .025, '#c9b48a'));
    for (const o of [Cr.rope, Cr.rope2, Cr.block]) { o.removeFromParent(); scene.add(o); }
  }
  pose(ang, r, hookY, sw = V3(), { load = null, tagTo = null } = {}) {
    const Cr = this.Cr, g = Cr.g; Cr.slew.rotation.y = ang; Cr.trolley.position.set(r, -.6, 0); g.updateMatrixWorld(true);
    const T = Cr.trolley.getWorldPosition(V3()), blk = V3(T.x + sw.x, hookY, T.z + sw.z);
    for (const [rp, o] of [[Cr.rope, -.25], [Cr.rope2, .25]]) { const side = V3(Math.cos(ang + Math.PI / 2), 0, -Math.sin(ang + Math.PI / 2)).multiplyScalar(o); aim(rp, T.clone().add(side), blk.clone().add(side).add(V3(0, .9, 0))); }
    Cr.block.position.copy(blk).add(V3(0, 0, 0)); Cr.block.rotation.set(0, ang, 0); this.blk = blk;
    const on = !!load; this.slings.forEach(m => m.visible = on); this.tags.forEach(m => m.visible = on && !!tagTo);
    if (load) { const c = load.c, h = load.size, top = c.y + h.y / 2, corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      this.slings.forEach((m, k) => aim(m, blk.clone().add(V3(0, -.9, 0)), V3(c.x + corners[k][0] * h.x * .36, top, c.z + corners[k][1] * h.z * .36)));
      if (tagTo) this.tags.forEach((m, k) => aim(m, V3(c.x + (k ? 1 : -1) * h.x * .45, c.y - h.y * .25, c.z + (k ? -1 : 1) * h.z * .3), tagTo[k])); }
  }
}

// a sequence of holds: a fixed build state, one lift flown in by one crane and seated; the other crane slews slowly with its empty hook
// swinging. holds: [{ u, dur, crane, side, slew (deg still to go at the start), rate (deg/s at the start), drop (m to lower),
// lower: [s0, s1] (when the hoist lowers, s into the hold), tag: [[x, z], [x, z]] (the men on the tag lines), idle: per crane
// { from, to (deg), base, r, y } }
export class BuildHolds {
  constructor(E, Y, scene, cranes, holds, { sling = 5 } = {}) {
    this.E = E; this.Y = Y; this.scene = scene; this.holds = holds; this.sling = sling;
    this.drives = cranes.map(c => new CraneDrive(scene, c));
    E.liftsAt(0); const L = E._lifts; let t = 0; this.cuts = [];
    for (const h of holds) {
      h.t0 = t; t += h.dur; this.cuts.push(h.t0);
      if (h.lift === false) continue;
      const cands = L.filter(l => Math.abs(l.thr - h.u) < (h.win || .03) && (h.side ? l.side === h.side : true) && (h.minY == null || l.c.y > h.minY)).sort((a, b) => b.n - a.n);
      const pick = cands[0]; if (!pick) continue; h.thr = pick.thr; h.liftSide = pick.side; h.uHold = pick.thr - .0003;
    }
    this.T = t;
  }
  holdAt(t) { let k = 0; while (k + 1 < this.holds.length && t >= this.holds[k + 1].t0) k++; return k; }
  update(t) {
    const k = this.holdAt(t), h = this.holds[k], E = this.E, tau = t - h.t0;
    E.setBuild(h.uHold ?? h.u);
    if (this._k !== k) { this._lift?.dispose(); this._lift = null; this._k = k; E.update(); if (h.thr != null) this._lift = extractLift(E, h.thr, h.liftSide); }
    this.last = { tau };
    this.drives.forEach((D, i) => {
      const Cr = D.Cr, mast = Cr.g.position;
      if (i === h.crane && this._lift) {
        const Lf = this._lift, seat = Lf.seat, hh = Lf.size.y, loc = seat.clone().sub(mast), aT = Math.atan2(-loc.z, loc.x), rT = Math.hypot(loc.x, loc.z);
        const rate = (h.rate ?? 5.5) * d2r, dA = (h.slew ?? 8) * d2r, Ts = 2 * Math.abs(dA) / rate;   // decelerating from `rate` to rest over Ts
        const ang = s => s >= Ts ? aT : aT - dA * Math.pow(1 - s / Ts, 2), rad = s => lerp(rT + (h.trolley ?? 3), rT, sstep(-1, Ts * .9, s));
        const lowerAt = h.lower ?? [Ts * .55, Ts + .6], drop = h.drop ?? 2.6;
        const trol = s => { const a = ang(Math.min(s, Ts)), r = rad(s); return V3(mast.x + Math.cos(a) * r, 0, mast.z - Math.sin(a) * r); };
        // the load as a pendulum from the trolley, driven by the trolley's acceleration; damped hard once it is seated
        const Lr = Math.max(8, Cr.h - .6 - (seat.y - hh / 2)), w2 = G / Lr, dt = 1 / 240;
        let x = 0, z = 0, vx = 0, vz = 0, p0 = trol(-3 - dt), p1 = trol(-3);
        for (let s = -3; s < tau; s += dt) { const p2 = trol(s + dt), ax = (p2.x - 2 * p1.x + p0.x) / (dt * dt), az = (p2.z - 2 * p1.z + p0.z) / (dt * dt), damp = s > lowerAt[1] - .3 ? 6 : .1;
          vx += (-w2 * x - ax - damp * vx) * dt; vz += (-w2 * z - az - damp * vz) * dt; x += vx * dt; z += vz * dt; p0 = p1; p1 = p2; }
        const T = trol(tau), lowered = sstep(lowerAt[0], lowerAt[1], tau), cy = seat.y + drop * (1 - lowered);
        const seatK = sstep(lowerAt[1] - .6, lowerAt[1], tau), c = V3(lerp(T.x + x, seat.x, seatK), cy, lerp(T.z + z, seat.z, seatK));
        Lf.place(c);
        D.pose(ang(Math.min(tau, Ts)), rad(tau), c.y + hh / 2 + this.sling, V3(c.x - T.x, 0, c.z - T.z), { load: { c, size: Lf.size }, tagTo: h.tag ? h.tag.map(([a, b]) => V3(a, 1.3, b)) : null });
        Object.assign(this.last, { ang: ang(tau) / d2r, swing: Math.hypot(x, z), seated: tau >= lowerAt[1] });
      } else {
        const i0 = h.idle?.[i] || { from: 20, to: 0, r: Cr.jib * .6, y: Cr.h * .5 }, rate = 4 * d2r, span = (i0.to - i0.from) * d2r, Ts = Math.abs(span) / rate;
        const a = ((i0.base ?? 90) + i0.from) * d2r + span * sstep(0, Math.max(.1, Ts), tau), sw = V3(Math.sin(tau * .9 + i * 2) * .7, 0, Math.cos(tau * .7 + i) * .5);
        D.pose(a, i0.r, i0.y, sw, {});
      }
    });
    return { hold: k, ...this.last };
  }
}
