// COMMON WEALTH v12: the storm open (b0-4) and the loop's return (b60-64), after lab_worlds_c2 ?shot=storm.
// One relightable plate (relight.js) of the co-op elevator under the shelf cloud, baked once on first use; the strike
// and the red are light layers played per frame; the near wheat and the bolt render live.
// Piece-local changes over the lab shot (brief c4 P1):
//   - the wheat's flash shadow: a soft wedge that fans from the elevator's foot toward the lens with a penumbra that
//     widens with distance (the lab's box test drew a hard vertical split down the frame)
//   - the bolt: a tapered, jittered polyline with fractal branches (the lab's 14-46 m steps read as rectangles)
//   - RED: the lamp goes red on frame 1 and holds; three red layers (the headhouse, the shelf's underside over the
//     elevator, the land) and the lit wheat band turning from the strike's white to red over 6 frames.
import * as THREE from 'three';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField } from '../lib/fx/atmos3d.js';
import { CloudVolume } from '../lib/fx/clouds3d.js';
import * as AM from '../lib/fx/americana.js';
import * as C2 from '../lib/fx/americana_c2.js';
import { Relight, Channel, strikeEnvelope, channelEnvelope } from '../lib/fx/relight.js';

const V = (...a) => new THREE.Vector3(...a);
const deg = d => d * Math.PI / 180;
const LK = n => JSON.parse(JSON.stringify(LOOKS3[n]));
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const rngf = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// a lightning channel as a fractal polyline: the stepped leader subdivided (midpoint displacement, 3 levels), with
// branches that fork again, each strand thinner. Returns Channel strands [{ pts, w }].
function fractalStrands(top, ground, seed) {
  const r = rngf(seed), strands = [];
  const sub = (P, amp, lev) => { for (let l = 0; l < lev; l++) { const Q = [P[0]];
      for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        Q.push([(a[0] + b[0]) / 2 + (r() - 0.5) * L * amp, (a[1] + b[1]) / 2 + (r() - 0.5) * L * amp * 0.3, (a[2] + b[2]) / 2 + (r() - 0.5) * L * amp * 0.6], b); }
      P = Q; amp *= 0.8; } return P; };
  const walk = (a, b, n, kink) => { const P = [a]; for (let k = 1; k < n; k++) { const u = k / n;
      P.push([a[0] + (b[0] - a[0]) * u + (r() - 0.5) * kink * (1 - u * 0.6), a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u + (r() - 0.5) * kink * 0.5]); }
    P.push(b); return P; };
  const H = top[1] - ground[1];
  const main = sub(walk(top, ground, 9, H * 0.16), 0.42, 3);
  strands.push({ pts: main, w: 1 });
  const branch = (from, depth, w) => {
    const nb = depth === 0 ? 5 : 2;
    for (let k = 0; k < nb; k++) { const i0 = Math.floor(from.length * (0.08 + 0.55 * r())), p = from[i0], L = H * (depth === 0 ? 0.18 + 0.2 * r() : 0.07 + 0.08 * r()), side = r() < 0.5 ? -1 : 1;
      const end = [p[0] + side * L * (0.6 + 0.7 * r()), Math.max(ground[1] + 30, p[1] - L * (0.6 + 0.5 * r())), p[2] + (r() - 0.5) * L * 0.5];
      const pts = sub(walk(p, end, 4, L * 0.3), 0.5, 2); strands.push({ pts, w });
      if (depth < 1) branch(pts, depth + 1, w * 0.45); }
  };
  branch(main, 0, 0.42);
  return strands;
}

export async function makeStorm({ W = 1080, H = 1920, n = 6, nLayer = 3 } = {}) {
  const look = LK('STORM_AD');
  const Wd = new World({ w: W, h: H, shadows: 0, atmos: { look, samples: 2 }, far: 90000, near: 0.3 });
  const A = Wd.atmos;
  const lf = new LightField(A, { box: [-6000, -8000, 6000, 1000], res: 2048, haloPx: 16 });
  const f = V(0.62, 0, -0.78).normalize(), lat = V(-f.z, 0, f.x);
  const eD = 430, eP = f.clone().multiplyScalar(eD);
  const sb = [28, 520, 40], sz0 = f.z * sb[0], sz1 = f.z * sb[1];
  const plains = new AM.Plains(Wd, A, lf, { center: [0, -20000], size: 90000, seg: 420, towns: [], railZ: eP.z - 60, hwyZ: 40000, palette: 'summer', creek: AM.makeCreek({ x0: -9000 }), detail: 2 });
  plains.u.uStrip.value.set((sz0 + sz1) / 2, Math.abs(sz1 - sz0) / 2, sb[2], 25);
  const gy = plains.h(eP.x, eP.z);
  const EL = new C2.Elevator(Wd, lf, { at: [eP.x, gy, eP.z], yaw: -deg(18), silo: { d: 9.4, h: 36, rows: 2, per: 5 }, head: { w: 13, d: 13, h: 50 }, annex: 3 });
  new AM.Farmsteads(Wd, lf, plains, { rect: [-9000, -9000, 9000, -2500], share: 0.5, lightGain: 0.6 });
  new AM.WindFarm(Wd, lf, plains, { points: AM.ridgeSites(plains, [3000, -12000, 12000, -6000], { n: 10, seed: 5 }), lit: 0.5 });
  // the strike behind the elevator and right of it: its ground point chosen so the elevator's shadow runs from the
  // foot toward the lower LEFT of frame (a diagonal wedge, not a vertical split)
  const cam0 = V(0, plains.h(0, 0) + 1.55, 0);
  const aim = cam0.clone().addScaledVector(lat, -34).addScaledVector(f, 6);          // where the shadow's axis lands near the lens
  const axis = eP.clone().sub(aim).setY(0).normalize();
  const gP = eP.clone().addScaledVector(axis, 1250); gP.y = plains.h(gP.x, gP.z);
  const ch = new Channel(A, { top: [gP.x + 120, 760, gP.z - 180], ground: [gP.x, gP.y, gP.z], seed: 11, branches: 3, width: 0.55, glow: 7 });
  ch.strands = fractalStrands([gP.x + 120, 760, gP.z - 180], [gP.x, gP.y, gP.z], 23);
  lf.build();
  const shelf = new CloudVolume(A, { kind: 'shelf', edge: { z0: -1350, curve: 2.2e-5, h: 560, base: 1150 }, tower: { b0: 6000, top: 11500, halfW: 18000 }, rain: { dens: 0.05, z0: -3800, th: 0.5 },
    scale: 1 / 2200, detail: 1 / 520, erode: 0.28, sigma: 0.024, keyGain: 0.62, ms: 0.05, ambTop: ['#8a9cc0', 0.42], ambBot: ['#262c36', 0.07], albedo: ['#e8e4dc', 0.95],
    bake: true, res: 0.5, far: 45000, key: 'sun' });
  const wheat = new C2.NearWheat(A, Wd, { n: 16000, near: 1.0, far: 95, awnR: 20, spread: 0.72, yaw: Math.atan2(f.x, -f.z), strip: plains.u.uStrip, groundH: (x, z) => plains.h(x, z),
    gust: 1, alb: '#8a7850', sat: 0.4, rim: { dir: [f.x, 0.04, f.z], color: '#ffcf8a', k: 0.35 } });
  // the wedge shadow (replaces the box test): light at L, the elevator's mass as a disc of radius hw at E
  const Lp = V(...ch.at(0.9));
  Object.assign(wheat.U, { uFanL: { value: Lp.clone() }, uFanE: { value: new THREE.Vector4(EL.foot.x, EL.foot.z, 24, 60) } });
  wheat.U.uOccN.value = 0;
  wheat.mesh.traverse(o => { if (!o.isMesh) return; const m = o.material; if (m.userData.cwFan) return; m.userData.cwFan = true;
    m.fragmentShader = m.fragmentShader
      .replace('uniform int uOccN;', 'uniform vec3 uFanL; uniform vec4 uFanE; uniform int uOccN;')
      .replace('float sh = uFlash > 0. ? 1. - occluded(vWP, F) : 1.;', `
        vec2 lp = uFanL.xz, e = uFanE.xy, pq = vWP.xz; vec2 d = lp - pq; float dl = length(d); d /= dl;
        float along = dot(e - pq, d);                                                   // the elevator between here and the light?
        float perp = length(e - pq - d * along);
        float pen = 2. + uFanE.w * max(along, 0.) / max(dl - along, 1.);             // penumbra grows away from the foot
        float inS = (1. - smoothstep(uFanE.z - pen, uFanE.z + pen, perp)) * smoothstep(0., 40., along) * step(along, dl);
        float sh = 1. - .92 * inS;`);
    m.needsUpdate = true; });
  const beacon = new C2.Beacon(A, EL.lampAt.toArray(), { size: 3.2, color: [1, 0.72, 0.4], i: 0.6 });
  // ---- the relight rig
  const R = new Relight(A, { clouds: [shelf] }); R.live(wheat.mesh);
  const fdir = Lp.clone().sub(EL.foot).normalize();
  const key = A.key, hemi = Wd._hemi, save = {};
  const rig = on => { if (on) { save.kp = key.position.clone(); save.kc = key.color.clone(); save.ki = key.intensity; save.hi = hemi ? hemi.intensity : 0; save.lg = lf.U.uLightGain.value;
      save.st = plains.u.uStrip.value.clone(); save.at = shelf.U.uAmbTop.value.clone(); save.ab = shelf.U.uAmbBot.value.clone(); save.kf = shelf.keyFrom; save.fc = shelf.U.uFlashC.value.clone(); }
    else { key.position.copy(save.kp); key.color.copy(save.kc); key.intensity = save.ki; if (hemi) hemi.intensity = save.hi; lf.U.uLightGain.value = save.lg;
      plains.u.uStrip.value.copy(save.st); shelf.U.uAmbTop.value.copy(save.at); shelf.U.uAmbBot.value.copy(save.ab); shelf.keyFrom = save.kf; shelf.flash([0, 0, 0], 0); shelf.U.uFlashC.value.copy(save.fc); } };
  const isolate = () => { if (hemi) hemi.intensity = 0; lf.U.uLightGain.value = 0; plains.u.uStrip.value.set(0, 1e9, 1, 0);
    shelf.keyFrom = { dir: [0, 1, 0], color: '#000000', k: 0 }; shelf.U.uAmbTop.value.setRGB(0, 0, 0); shelf.U.uAmbBot.value.setRGB(0, 0, 0); };
  // 1. the strike: a hard cool key from the channel (shadowed), the flash inside the cloud base
  R.layer('flash', { clouds: true, shadow: { dir: fdir.toArray(), max: 520, thick: 120, soft: 0.25 },
    set: k => { if (!save.on) { rig(true); save.on = true; } isolate();
      key.position.copy(fdir).multiplyScalar(1000); key.color.set('#d8e4ff'); key.intensity = k * 9;
      shelf.U.uFlashC.value.setRGB(0.78, 0.84, 1);
      shelf.flash([...ch.at(0.05)].map((v, i) => i === 1 ? v + 180 : v), k, 1100, 700); },
    done: () => { if (save.on) { rig(false); save.on = false; } } });
  // 2. the red afterglow on the land and the elevator: the same key, red, from low over the lamp's side
  const rdir = EL.lampAt.clone().add(V(0, 260, 0)).sub(cam0).setY(0).normalize().setY(0.55).normalize().multiplyScalar(-1).add(fdir).normalize();
  R.layer('redkey', { shadow: { dir: rdir.toArray(), max: 520, thick: 120, soft: 0.35 },
    set: k => { if (!save.on) { rig(true); save.on = true; } isolate(); key.position.copy(rdir).multiplyScalar(1000); key.color.set('#ff2a14'); key.intensity = k * 7; },
    done: () => { if (save.on) { rig(false); save.on = false; } } });
  // 3. the shelf's underside over the elevator, lit red from below (the lamp's glow in the rain air)
  R.layer('redsky', { clouds: true,
    set: k => { if (!save.on) { rig(true); save.on = true; } isolate(); key.intensity = 0;
      shelf.U.uFlashC.value.setRGB(1, 0.09, 0.03); shelf.flash([EL.lampAt.x, 1050, EL.lampAt.z], k * 3.2, 2600, 1800); },
    done: () => { if (save.on) { rig(false); save.on = false; } } });
  // 4. the lamp's own reach on the headhouse
  const red = new THREE.PointLight('#ff2010', 0, 60, 1.6); red.position.copy(EL.lampAt); Wd.scene.add(red);
  R.layer('red', { set: k => { if (!save.on2) { save.on2 = true; save.rk = key.intensity; save.rh = hemi ? hemi.intensity : 0; save.rl = lf.U.uLightGain.value; }
      key.intensity = 0; if (hemi) hemi.intensity = 0; lf.U.uLightGain.value = 0; red.intensity = k * 12000; },
    done: () => { red.intensity = 0; if (save.on2) { key.intensity = save.rk; if (hemi) hemi.intensity = save.rh; lf.U.uLightGain.value = save.rl; save.on2 = false; } } });
  R.plan = [
    { kind: 'sky', y0: -0.2, y1: 0.36, feather: 0.1, gain: 0.3, sat: 0.55 },           // the tower burned to a dark mass: the word sits in it
    { kind: 'sky', y0: -0.2, y1: 0.16, feather: 0.08, gain: 0.55, sat: 0.4 },
    { kind: 'dist', d0: 1400, d1: 1e5, feather: 0.4, gain: 0.72, sat: 0.7 },
  ];
  // the camera: the lab's slow push (u over 3 s); before the strike (ts < 0, the loop's return) it slides in from
  // 7 m back and 2.5 m up, the shelf coming down over the frame
  const pitch = deg(8.5);
  const cam = ts => { const u = clamp(ts / 3), e = u * u * (3 - 2 * u) * 0.6 + u * 0.4;
    const p = cam0.clone().addScaledVector(f, 2.2 * e); p.y += 0.25 * e;
    let pk = pitch;
    const tg = p.clone().addScaledVector(f, 400); tg.y = p.y + 400 * Math.tan(pk);
    return { pos: p.toArray(), target: tg.toArray(), fov: 58 }; };
  const t0 = performance.now();
  R.bake(cam(0), 0, { n, nLayer, over: 1.14 });
  const bakeMs = Math.round(performance.now() - t0);
  const flashDir = Lp.clone();
  const proj = p => { const c = A.camera, v = p.clone().project(c); return [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H, v.z]; };
  // per frame. ts = seconds from the strike (negative = the storm coming back round before it). Returns the canvas.
  // o.build 0..1: the pre-strike build (far flicker in the cloud, the lamp brightening)
  function render(ts, o = {}) {
    const f30 = Math.round(ts * 30);
    const k = ts >= 0 ? strikeEnvelope(ts, 0) : 0, c = ts >= 0 ? channelEnvelope(ts, 0) : 0;
    const redOn = f30 >= 1, redK = redOn ? clamp((f30 - 1) / 6) : 0;          // white -> red over 6 frames
    let pre = 0;
    if (ts < 0 && o.build) { const b = o.build, fl = Math.max(0, Math.sin(ts * 23.1) * Math.sin(ts * 9.7 + 1.3)); pre = b * b * 0.22 * (fl > 0.55 ? 1 : 0.15) * (f30 > -4 ? 0 : 1); }
    R.w.flash = k + pre;
    R.w.redkey = redOn ? 0.6 + 0.3 * Math.exp(-(f30 - 1) / 5) : 0;
    R.w.redsky = redOn ? 1.0 + 0.4 * Math.exp(-(f30 - 1) / 6) : 0;
    R.w.red = redOn ? 1 : 0;
    ch.set(c * 40);
    wheat.U.uFlash.value = ts >= 0 ? (redOn ? 1.2 * Math.max(k, 0.55) : k * 1.2) : pre * 2;
    wheat.U.uFlashCol.value.setRGB(0.81, 0.86, 1).lerp(new THREE.Color(1, 0.08, 0.03), redK);
    wheat.U.uFlashDir.value.copy(flashDir).sub(A.camera.position).normalize();
    wheat.U.uRed.value = redOn ? 1 : 0;
    beacon.set(redOn ? 4.5 : ts < 0 ? 0.6 + 0.6 * (o.build || 0) : 0.6, redOn ? [1, 0.08, 0.04] : [1, 0.72, 0.4]);
    R.render(cam(ts), ts + 10);
    return Wd.canvas;
  }
  return { render, cam, proj, lampAt: EL.lampAt.clone(), bakeMs, canvas: Wd.canvas, A };
}
