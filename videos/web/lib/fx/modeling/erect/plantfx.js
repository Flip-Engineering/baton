// ERECT plant effects (MODELING c5): what a 1,000-tonne flat foot does to snow over mud in the first two seconds, as sources for
// light/medium.js (Medium.add: { kind, puffs(t) -> [{ x, y, z, r, sy, d, a }] }) and the c4 event Kit's clods.
//
// Why (c4 judge, c5 critic): c4's dust "arrives about 1.3 s after the contact", is "a smooth cream glow with no billows, lumps or
// thrown material", and the people do not move. Reference: a helicopter's brownout ring, a pile-driver strike, a building collapse
// at street level. The air under a flat sole is squeezed out sideways at the instant of contact, so the FIRST thing is a thin fast
// sheet that leaves every edge of the sole on the contact frame (plantRing); that sheet slows within a second and its front curls
// up into billows that roll and climb, lit on the sun side (plantRoll); dark lumps of frozen mud and snow are thrown ahead of the
// dust on ballistic arcs, AWAY from the sole (throwClods); and the burst is wider along the foot's long axis (more air squeezed).
//
//   med.add(plantRing({ pos: [x, 0, z], t0, foot: [7.4, 13], yaw }));  med.add(plantRoll({ ... }));
//   throwClods(kit, t0, [x, z], { foot: [7.4, 13], yaw, n: 70 });
import * as THREE from 'three';
const TAU = Math.PI * 2;
function rnd(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// a point on the sole's outline and its outward normal (rectangle w x l, yaw in degrees, centred at pos)
function edge(u, w, l, yaw) {
  const P = 2 * (w + l), s = u * P; let x, z, nx, nz;
  if (s < w) { x = -w / 2 + s; z = l / 2; nx = 0; nz = 1; } else if (s < w + l) { x = w / 2; z = l / 2 - (s - w); nx = 1; nz = 0; }
  else if (s < 2 * w + l) { x = w / 2 - (s - w - l); z = -l / 2; nx = 0; nz = -1; } else { x = -w / 2; z = -l / 2 + (s - 2 * w - l); nx = -1; nz = 0; }
  const c = Math.cos(yaw * Math.PI / 180), sn = Math.sin(yaw * Math.PI / 180);
  // round the corners' normals a little so the ring is continuous
  if (Math.abs(x) > w / 2 - .6 && Math.abs(z) > l / 2 - .6) { nx = Math.sign(x) * .7; nz = Math.sign(z) * .7; }
  return { x: x * c + z * sn, z: -x * sn + z * c, nx: nx * c + nz * sn, nz: -nx * sn + nz * c };
}
// the squeezed sheet: leaves the edges on the contact frame at v0 ~ 16 m/s x sqrt(energy), slows with tau 0.3 s, hugs the ground
export function plantRing({ pos, t0 = 0, foot = [7.4, 13], yaw = 0, energy = 1, n = 120, seed = 3, albedo = .62, wind = [.6, 0, .2] } = {}) {
  const R = rnd(seed), E = Math.sqrt(energy), P = [];
  for (let i = 0; i < n; i++) { const e = edge((i + R() * .8) / n, foot[0], foot[1], yaw); P.push({ ...e, v: (11 + 9 * R()) * E, tau: .26 + .14 * R(), s: .7 + .6 * R(), h: .15 + .5 * R(), ph: R() * TAU }); }
  return { kind: 'dust', puffs(t) {
    const a = t - t0; if (a <= 0 || a > 9) return [];
    const out = [];
    for (const p of P) { const d = p.v * p.tau * (1 - Math.exp(-a / p.tau)), lift = p.h + .35 * a + .25 * Math.sin(p.ph + a * 3) * Math.min(1, a);
      out.push({ x: pos[0] + p.x + p.nx * (d + .3) + wind[0] * a, y: pos[1] + Math.max(.12, lift * .6), z: pos[2] + p.z + p.nz * (d + .3) + wind[2] * a,
        r: (.35 + .55 * Math.sqrt(a) * E) * p.s, sy: .45, d: 1.25 * Math.exp(-a / 1.8) * Math.min(1, a / .03), a: albedo }); }
    return out;
  } };
}
// the billows: the sheet's front curls up and rolls outward and upward, slower, bigger, longer-lived, lumpy (each billow is a
// cluster of 3-5 puffs turning over)
export function plantRoll({ pos, t0 = 0, foot = [7.4, 13], yaw = 0, energy = 1, n = 34, seed = 9, albedo = .66, wind = [.8, 0, .25] } = {}) {
  const R = rnd(seed), E = Math.sqrt(energy), B = [];
  for (let i = 0; i < n; i++) { const e = edge((i + R()) / n, foot[0], foot[1], yaw); const k = [];
    for (let j = 0, m = 3 + (R() * 3 | 0); j < m; j++) k.push({ o: R() * TAU, rr: .4 + .6 * R(), s: .6 + .7 * R() });
    B.push({ ...e, reach: (5 + 5 * R()) * E, tau: .7 + .5 * R(), climb: (1.6 + 2.6 * R()) * E, delay: .08 + .2 * R(), k }); }
  return { kind: 'dust', puffs(t) {
    const out = [];
    for (const b of B) { const a = t - t0 - b.delay; if (a <= 0 || a > 12) continue;
      const d = b.reach * (1 - Math.exp(-a / b.tau)), up = b.climb * (1 - Math.exp(-a / 1.1)) + .25 * a, R0 = (.9 + 1.0 * Math.sqrt(a)) * E, turn = a * 1.6 / (1 + a * .4);
      for (const q of b.k) { const ang = q.o + turn, ox = Math.cos(ang) * R0 * .55 * q.rr, oy = Math.sin(ang) * R0 * .55 * q.rr;
        out.push({ x: pos[0] + b.x + b.nx * (d + 1 + ox) + wind[0] * a, y: pos[1] + .4 + up + oy * .8, z: pos[2] + b.z + b.nz * (d + 1 + ox) + wind[2] * a,
          r: R0 * q.s, sy: .8, d: .85 * Math.exp(-a / 4.5) * Math.min(1, a / .25), a: albedo }); } }
    return out;
  } };
}
// clods thrown AWAY from the sole: launched from points along its edges with the edge's outward normal, 6-14 m/s, 15-50 degrees up;
// the near-side ones fly toward whoever stands there. kit = the c4 events Kit (instanced lit chunks, one bounce).
export function throwClods(kit, t0, [x, z], { foot = [7.4, 13], yaw = 0, n = 70, seed = 4, speed = 1, cols = ['#3a3028', '#55463a', '#2a241f', '#46392e', '#d8d8d2'] } = {}) {
  const R = rnd(seed), V = (a, b, c) => new THREE.Vector3(a, b, c);
  for (let i = 0; i < n; i++) { const e = edge(R(), foot[0], foot[1], yaw), v = (6 + 8 * R()) * speed, el = (15 + 35 * R()) * Math.PI / 180;
    kit.falls.push({ t0: t0 + R() * .12, p: V(x + e.x + e.nx * .4, .5 + R() * .8, z + e.z + e.nz * .4), v: V(e.nx * v * Math.cos(el) + (R() - .5) * 2, v * Math.sin(el), e.nz * v * Math.cos(el) + (R() - .5) * 2),
      s: .07 + Math.pow(R(), 2.5) * .42, col: cols[(R() * cols.length) | 0], rot: V(R() * 6, R() * 6, R() * 6), spin: (R() - .5) * 10 }); }
  kit.cue(t0, 'debris', Math.min(1, n / 60), null);
}
