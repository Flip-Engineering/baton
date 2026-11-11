// HAIR / layers: the structured hair forms a flow field cannot make (HUMAN c8 lane D), registered into styles.js's LAYER table.
//   cornrows  rows of plaits lying on the scalp from the front hairline back to the nape, the scalp showing between them; the rows
//             converge on the nape the way meridians do; optional braids hanging from their ends
//   locs      ropes of felted hair from scalp roots, hanging under gravity on the head and shoulders, or gathered and tied
//   roll      a roll of hair along a path on the head (the 1940s rolled front and the victory roll at the nape): a core with the hair
//             running round it and cards wrapping it, fed by the scalp hair combed into it
//   pincurls  flat spiral curls pinned to the scalp (under a bandana or a snood the front ones show)
//   puff      a ball of coily hair gathered at a point (a puff, a gathered afro)
//   afro      natural coily hair standing in its own volume: shells of short coily cards between the scalp and a rounded envelope,
//             with a fuzz of standing cards at the silhouette (the envelope is the haircut: an ellipsoid in head units)
import * as THREE from 'three';
import { sstep } from './field.js';
import { V, clamp, sampleRoots, flowFn, growStrand, curlPts, skinBlend, resamplePts, arcLen } from './grow.js';
import { registerLayer, FORMS, rope, frames, nearestOn, plait, cm, belowHat } from './styles.js';

// the scalp point at a given azimuth (rad from the front) and height above the eye centre (m): search the elevation of the ray
function scalpAt(F, ph, ys) {
  let lo = -1.2, hi = 1.5, best = null;
  for (let it = 0; it < 28; it++) { const th = (lo + hi) / 2, d = [Math.cos(th) * Math.sin(ph), Math.sin(th), Math.cos(th) * Math.cos(ph)], c = F.cast(d[0], d[1], d[2]); if (!c) break;
    const p = F.C.clone().add(V(...d).multiplyScalar(c.r)); best = { p, c }; if (p.y - F.eyeY > ys) hi = th; else lo = th; }
  return best;
}
const spAtP = (F, p) => { const c = F.cast(p.x - F.C.x, p.y - F.C.y, p.z - F.C.z); return c ? F.surf(c.tri, c.b1, c.b2) : null; };
const lift = (F, p, off) => { const d = p.clone().sub(F.C), l = d.length(); d.divideScalar(l); const r = F.rAt(d.x, d.y, d.z); return F.C.clone().addScaledVector(d, (r || l) + off); };

// ---------------------------------------------------------------- cornrows
registerLayer('cornrows', (ctx, L, dens) => {
  // each row is a curve in direction space about the skull centre: a great circle from the front over the top to the back, tilted
  // sideways by a lateral angle psi (psi = 0 the mid-line; a side row is a small circle round the head's x axis, so it runs front to
  // back above the ear the way side rows do), the rows converging a little toward the nape; a row starts where it crosses the front
  // hairline and stops where it leaves the hair at the nape (or meets the ear's bare zone)
  const { F, B, rnd } = ctx, n = L.rows ?? 10, psiMax = (L.spread ?? 62) * Math.PI / 180, r = cm(L.r ?? 0.45), conv = L.converge ?? 0.45;
  let rows = 0, segs = 0;
  for (let i = 0; i < n; i++) {
    const s0 = -1 + 2 * (i + 0.5) / n, raw = [];
    let on = false;
    for (let th = -0.35; th < 4.6; th += 0.008) {
      const psi = s0 * psiMax * (1 - conv * sstep(2.6, 4.1, th)), d = V(Math.sin(psi), Math.cos(psi) * Math.sin(th), Math.cos(psi) * Math.cos(th)), rr = F.rAt(d.x, d.y, d.z); if (!rr) { if (on) break; continue; }
      const p = F.C.clone().addScaledVector(d, rr), ph = Math.atan2(p.x - F.C.x, p.z - F.C.z), de = dens(p, ph);
      if (!on && de > 0.5) on = true; else if (on && de < 0.4) break;
      if (on) raw.push(p);
    }
    if (raw.length < 6) continue;
    const Lr = arcLen(raw), pts = resamplePts(raw, Math.max(6, Math.round(Lr / 0.005))).map(p => lift(F, p, r * 0.5));
    const sp = spAtP(F, raw[0]), fr = frames(pts);
    plait({ ...ctx }, pts, fr, r, r * 0.8, { stitch: L.stitch ?? 1.1, flat: 0.45, form: ctx.form, tie: false, up: p => p.clone().sub(F.C).normalize(), sides: 5, perStitch: 7, fly: 10 }, sp);
    rows++; segs += pts.length;
    if (L.ends) { const e = pts.at(-1), R = rope(F, F.toHU(e), [0, -1, -0.3], cm(L.ends.len ?? 20), r, { r1: r * 0.7, grav: 1.2 }); plait(ctx, R.pts, frames(R.pts), r, r * 0.7, { stitch: 1.3, form: ctx.form, sides: 5, perStitch: 8, fly: 8 }, R.sp); }
  }
  ctx.stats.push({ kind: 'cornrows', rows, segs });
});

// ---------------------------------------------------------------- locs
registerLayer('locs', (ctx, L, dens) => {
  const { F, B, rnd, o } = ctx, n = Math.round((L.count ?? 110) * (o.density ?? 1)), r0 = cm(L.r ?? 0.45);
  const flow = flowFn(F, L.flow || { type: 'down' }), roots = sampleRoots(F, dens, n, rnd);
  let made = 0;
  for (const sp of roots) {
    const len = cm(L.len[0] + (L.len[1] - L.len[0]) * rnd()), r = r0 * (0.8 + 0.4 * rnd());
    const g = growStrand(F, sp, len, { lift: L.lift ?? 0.25, stiff: 0.85, comb: L.comb ?? 0.5, grav: L.grav ?? 1.1, jit: 0.15, off0: r * 0.9, off1: r * 2.2, segLen: 0.012, maxSeg: 40, cling: L.cling ?? 0.3, gather: L.gather, hatMargin: r }, rnd, flow);
    if (g.hidden && !o.keepHidden) continue;
    const pts = g.pts; if (pts.length < 3) continue;
    const ph = rnd() * 6.28, lumpy = (th, t, s) => 1 + 0.12 * Math.sin(s * 180 + ph) + 0.06 * Math.sin(th * 3 + s * 90);
    B.tube(pts, { tile: 'loc', r: t => r * (t < 0.06 ? 0.6 + 0.4 * t / 0.06 : 1 - 0.25 * t), rTh: lumpy, sides: 7, depth: 0.3, rand: rnd(), grey: ctx.greyBias(sp.p), vScale: 0.04, skin: p => skinBlend(F, sp, p), out: p => p.clone().sub(nearestOn(pts, p)).normalize() });
    // fuzz: a few short cards standing off the loc
    for (let c = 0; c < 3; c++) { const k = 1 + Math.floor(rnd() * (pts.length - 2)), a = pts[k], b = pts[Math.min(pts.length - 1, k + 1)], side = b.clone().sub(a).cross(V(0, 0, 1)).normalize();
      B.ribbon([a.clone().addScaledVector(side, r * 0.8), b.clone().addScaledVector(side, r * 1.8)], { tile: 'fuzz', w0: cm(0.9), w1: cm(0.6), roll: rnd() * 3, depth: 0, rand: rnd(), grey: 0, out: p => side, skin: p => skinBlend(F, sp, p) }); }
    made++;
  }
  ctx.stats.push({ kind: 'locs', locs: made });
});

// ---------------------------------------------------------------- roll (the 1940s rolled front, a victory roll)
registerLayer('roll', (ctx, L) => {
  const { F, B, rnd } = ctx, Fm = FORMS[L.form || ctx.form] || FORMS.straight, r = cm(L.r ?? 1.4);
  const axis = resamplePts(L.path.map(a => lift(F, F.fromHU(a), r * (L.sink ?? 0.85))), Math.max(16, Math.round(arcLen(L.path.map(a => F.fromHU(a))) / 0.004)));
  const sp = spAtP(F, axis[Math.floor(axis.length / 2)]);
  B.tube(axis, { tile: 'dense', r: t => r * (0.55 + 0.45 * Math.sin(Math.PI * clamp(t * 1.15 - 0.075))), sides: 12, around: true, turns: 1, depth: 0.6, rand: rnd(), grey: ctx.greyBias(axis[0]), vScale: cm(1.2), skin: p => skinBlend(F, sp, p), out: p => p.clone().sub(nearestOn(axis, p)).normalize() });
  // cards wrapping it: each a helix of ~1.2 turns round the axis, advancing a little along it
  const n = Math.round(L.clumps ?? 70), fr = frames(axis), M = axis.length;
  for (let c = 0; c < n; c++) {
    const k0 = Math.floor(rnd() * M), span = Math.floor(M * (0.05 + 0.08 * rnd())), a0 = rnd() * 6.28, turns = 1 + 0.4 * rnd(), q = [];
    for (let s = 0; s <= 16; s++) { const t = s / 16, k = Math.min(M - 1, Math.max(0, k0 + Math.round((t - 0.5) * span))), a = a0 + turns * 6.283 * t;
      const rad = r * (0.55 + 0.45 * Math.sin(Math.PI * clamp(k / (M - 1) * 1.15 - 0.075))) * (1.02 + 0.08 * rnd());
      q.push(axis[k].clone().addScaledVector(fr[k].nx, Math.cos(a) * rad).addScaledVector(fr[k].ny, Math.sin(a) * rad)); }
    B.ribbon(q, { tile: Fm.tile === 'coily' ? 'coily' : 'straight', ua: rnd() * 0.3, ub: 0.7 + 0.3 * rnd(), w0: cm(1.0), w1: cm(0.8), taper: 3, roll: 0, depth: 0.2, rand: rnd(), grey: ctx.greyBias(axis[0]), out: p => p.clone().sub(nearestOn(axis, p)).normalize(), skin: p => skinBlend(F, sp, p) });
  }
  ctx.stats.push({ kind: 'roll', clumps: n, len: +arcLen(axis).toFixed(3) });
});

// ---------------------------------------------------------------- pin curls
registerLayer('pincurls', (ctx, L) => {
  const { F, B, rnd } = ctx, Fm = FORMS[L.form || ctx.form] || FORMS.straight, r = cm(L.r ?? 1.1);
  for (const a of L.at) {
    const P0 = lift(F, F.fromHU(a), 0.0025), sp = spAtP(F, P0), n = P0.clone().sub(F.C).normalize(), e1 = V(0, 1, 0).cross(n).normalize(), e2 = n.clone().cross(e1);
    for (let c = 0; c < 4; c++) { const ph = c * 1.57 + rnd(), q = [];
      for (let s = 0; s <= 22; s++) { const t = s / 22, th = ph + t * 1.75 * 6.283, R = r * (1 - 0.72 * t); q.push(lift(F, P0.clone().addScaledVector(e1, Math.cos(th) * R).addScaledVector(e2, Math.sin(th) * R), 0.0018 + 0.0022 * (1 - t))); }
      B.ribbon(q, { tile: 'dense', ua: 0.2, ub: 0.8, w0: r * 0.42, w1: r * 0.28, roll: 0, depth: 0.3, rand: rnd(), grey: ctx.greyBias(P0), out: () => n, skin: p => skinBlend(F, sp, p) }); }
  }
  ctx.stats.push({ kind: 'pincurls', curls: L.at.length });
});

// ---------------------------------------------------------------- a puff (a ball of coily hair)
registerLayer('puff', (ctx, L) => {
  if (ctx.F.hat) L = { ...L, at: belowHat(ctx.F, L.at, cm((L.size ?? [6, 5.5, 5])[1]) * 0.6), size: (L.size ?? [6, 5.5, 5]).map(x => x * 0.8) };   // worn low at the nape under a hat
  const { F, B, rnd, o } = ctx, sz = (L.size ?? [6, 5.5, 5]).map(cm), T = F.onScalp(L.at, 0), nrm = T.clone().sub(F.C).normalize(), Cn = T.clone().addScaledVector(nrm, sz[2] * 0.62), sp = spAtP(F, T);
  const ez = nrm, ex = V(0, 1, 0).cross(ez).normalize(), ey = ez.clone().cross(ex), n = Math.round((L.clumps ?? 260) * (o.density ?? 1));
  for (let c = 0; c < n; c++) {
    let u; do { u = V(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (u.lengthSq() > 1 || u.lengthSq() < 0.05); u.normalize();
    if (u.z < -0.55 && rnd() < 0.8) u.z = -u.z;                                  // little hair on the face against the head
    const E = q => Cn.clone().addScaledVector(ex, q.x * sz[0]).addScaledVector(ey, q.y * sz[1]).addScaledVector(ez, q.z * sz[2]);
    const shell = 0.55 + 0.45 * Math.sqrt(rnd()), outer = shell > 0.92, t0 = u.clone().multiplyScalar(shell - 0.18), t1 = u.clone().multiplyScalar(shell + (outer ? 0.12 : 0.02));
    const side = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(u).normalize().multiplyScalar(outer ? 0.02 : 0.22);
    const q = [E(t0), E(t0.clone().lerp(t1, 0.5).add(side)), E(t1)].map(p => F.push(p, 0.002));
    B.ribbon(q, { tile: outer ? 'coilyFuzz' : 'coily', ua: rnd() * 0.3, ub: 0.7 + 0.3 * rnd(), w0: sz[0] * (outer ? 0.35 : 0.5), w1: sz[0] * 0.3, taper: 1, roll: outer ? (rnd() - 0.5) * 3 : (rnd() - 0.5) * 0.6, depth: 1 - shell, rand: rnd(), grey: ctx.greyBias(T), out: p => p.clone().sub(Cn).normalize(), bend: 0.85, skin: p => skinBlend(F, sp, p) });
  }
  ctx.stats.push({ kind: 'puff', clumps: n });
});

// ---------------------------------------------------------------- natural coily hair in its own volume (an afro, a TWA)
// env: [ax, ay, az, yc] the envelope in head units about the skull centre (yc shifts it up); vol: shells between the scalp and it
registerLayer('afro', (ctx, L, dens) => {
  // (HAIR4, rev 4: the coil mass is the baked coily tile, repeated at its own size: narrower cards, more of them)
  const { F, B, rnd, o } = ctx, env = L.env || [1.45, 1.35, 1.4, 0.15], shells = L.shells ?? 6, n = Math.round((L.clumps ?? 1600) * (o.density ?? 1) * (L.clumps5K ?? 2.2));   // (HAIR5: more, narrower)
  const roots = sampleRoots(F, dens, n, rnd), EnvR = d => 1 / Math.hypot(d.x / (env[0] * F.rx), d.y / (env[1] * F.ry), d.z / (env[2] * F.rz));
  let made = 0;
  for (const sp of roots) {
    const d = sp.p.clone().sub(F.C), rs = d.length(); d.normalize();
    // the envelope's radius along this direction, never under the scalp + 1.5 cm (a TWA's minimum)
    const C2 = F.C.clone().add(V(0, env[3] * F.ry, 0)), v2 = sp.p.clone().sub(C2), l2 = v2.length();
    let reach = clamp(EnvR(v2.divideScalar(l2)) - l2, 0.015, cm(L.maxLen ?? 7));
    // (HAIR3, opt-in L.nape cm) the hair low at the nape and the sideburns is short: the envelope reached down past the jaw there and
    // its cards hung beside the neck
    if (L.nape != null) { const low = sstep(F.earTop - F.eyeY - 0.005, F.earTop - F.eyeY - 0.055, sp.p.y - F.eyeY); reach = reach * (1 - low) + Math.min(reach, cm(L.nape)) * low; }
    { const nape = cm(L.nape ?? 1.8); reach = Math.min(reach, nape + Math.max(0, reach - nape) * sstep(F.earTop - F.eyeY - 0.02, F.earTop - F.eyeY + 0.05, sp.p.y - F.eyeY)); }   // (HAIR5: the band as for the coils)
    const k = Math.floor(rnd() * shells), sh = (k + 0.5 + 0.4 * (rnd() - 0.5)) / shells, outer = k === shells - 1;
    const base = sp.p.clone().addScaledVector(d, reach * sh);
    const t = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).addScaledVector(d, 0).cross(d).normalize(), Lc = cm(L.card ?? 3.2) * (0.7 + 0.6 * rnd());
    const q = [base.clone().addScaledVector(t, -Lc / 2), base.clone().addScaledVector(d, outer ? 0.004 : 0.0015), base.clone().addScaledVector(t, Lc / 2)].map(p => F.push(p, 0.004));
    // under a hat: the hair is pressed into the hat's inner shell; a pressed card is narrowed and laid flat in it (a wide or rolled card
    // with its centreline inside still put its edges through a fitted knit hat)
    let pressed = false;
    if (F.hat) { let hid = true; for (const p of q) { if (F.hat.clamp(p, 0.004)) { pressed = true; F.push(p, 0.002); F.hat.clamp(p, 0.004); } else hid = false; } if (hid && !o.keepHidden && q[0].y > F.hat.rimAt(sp.ph) - 0.002) continue; }
    const wk = pressed ? 0.35 : 1;
    const aw = L.width5 ?? 0.8;
    B.ribbon(q, { tile: outer ? 'coilyFuzz' : 'coily', ua: rnd() * 0.3, ub: 0.7 + 0.3 * rnd(), w0: cm(aw) * wk, w1: cm(aw * 0.8) * wk, taper: 1, roll: pressed ? 0 : outer ? (rnd() - 0.5) * 2.2 : (rnd() - 0.5) * 0.4, depth: 1 - sh, rand: rnd(), grey: ctx.greyBias(sp.p), C: F.C, bend: 0.9, skin: p => skinBlend(F, sp, p) });
    made++;
  }
  ctx.stats.push({ kind: 'afro', clumps: made, shells });
});
export { scalpAt, lift, spAtP };
