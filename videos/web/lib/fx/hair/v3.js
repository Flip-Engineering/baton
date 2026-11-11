// HAIR / v3 (HAIR3, round 3, 3 Oct): women's hair that reads from the FRONT, and cards that read as hair at 1:1: the layer kinds of the
// v3 styles (assets/hair/styles/w3_*.json) and the ropes, coils and the hairline fringe every current groom uses.
//
// Why the women read as boys head-on (judge c8): lane D's grower clings every strand to the skull (the cling pulls a strand back to its
// offset surface wherever it is above the chin), so below the head's widest point loose hair followed the skull inward, the sides were
// tight and the ears bare; the working styles (low bun, low tail) hide all their hair behind the head. What a viewer reads as a woman's
// hair from the front is the hair's VOLUME beside the face (the silhouette wider than the skull from the temples down), hair over or
// beside the ears, a part, and hair that frames the face (pieces at the temples falling beside the cheeks).
//   mane    loose hair: roots over the scalp, each a CLUMP: a guide strand grown with a comb flow, stiffness and gravity, held off the
//           head by a volume profile (crown lift, a side volume that grows as the hair hangs) and released below the head's equator
//           (it drapes from the widest point instead of following the skull in), kept out of the face window, cut by a line, a bob's
//           turn-under or an envelope; then 2-4 narrow cards round the guide that converge toward the tip (hair clumps), and a few
//           flyaways. Flows: 'drape' (from a part across the top, then down the sides; the front combed a little back from the face),
//           'sweep' (a pixie: the front swept across the forehead to one side), or any lane D flow (gather, crop, back ...).
//   frame   face-framing pieces: mane clumps rooted in a band just inside the front hairline at the temples, falling beside the cheeks.
//   coils   defined coily hair at the surface of a coily volume (each clump a narrow card along a tight helix: a coil, not frizz),
//           over lane D's afro shells for the body of the volume.
//   braids  box braids / twists: many thin plaits from parted roots, grown as mane guides (volume at the roots, draped), each a tube
//           with a three-lobed twist and the plait tile.
//   locs3   locs with volume: lane D's loc tubes on mane guides.
// Methods: the clump-and-guide practice of every groom tool (Ward, Bertails, Kim, Marschner, Cani and Lin, "A survey on hair modeling",
// IEEE TVCG 13(2) 2007); clumping as Yuksel and Tariq's SIGGRAPH 2010 course and production grooms do it (strands drawn toward a clump
// centre by a profile along the strand); curl diameters after Loussouarn et al. 2007 (FORMS in styles.js). Our own code and styles.
import * as THREE from 'three';
import { sstep, REG } from './field.js';
import { V, clamp, sampleRoots, flowFn, curlPts, skinBlend, resamplePts, arcLen } from './grow.js';
import { registerLayer, FORMS, cm, rr, nearestOn } from './styles.js';

const G = V(0, -1, 0);
// (HAIR5, rev 5) the rope settle with a stronger comb to the back on the shoulder's top (bias 0.008 -> 0.024) and a little more weight:
// HAIR4's ropes from behind the ears piled on the trapezius as a collar (the band across the base of the neck); with the stronger comb they
// slide off the shoulder's top to the back and hang down it in two fans (the CPU look, bind, back view: hair5/NOTES.md). Without friction
// (fric 0) they slid out along the shoulders to the arms instead. o.rope5 overrides for experiments
const REV5_ROPE = { inward: 0.004, fric: 1, bias: 0.024, grav: 0.006 };
const proj = (v, n) => { const r = v.clone().addScaledVector(n, -v.dot(n)); const l = r.length(); return l > 1e-6 ? r.divideScalar(l) : null; };

// ---------------------------------------------------------------- the face window (no hair across the eyes, nose and mouth)
// a superellipse in x-y over the face, in front of the plane halfway from the skull centre to the eyes; `top` (cm above the eye centre)
// is the brow unless the style has bangs; `margin` (cm) beyond the outer eye corner
export function faceWindow(F, o = {}) {
  const z0 = F.C.z + 0.45 * (F.eL.z - F.C.z), top = F.eyeY + cm(o.top ?? 4.5), bot = F.chinY - cm(o.below ?? 0.5), yc = (top + bot) / 2, b = (top - bot) / 2;
  const a = Math.abs(F.eL.x - F.C.x) + cm(o.margin ?? 3.0), m = cm(o.pad ?? 0.25);
  // (exponent 6: a 4 let pieces cross the outer brow, where the window narrowed toward its top)
  const fn = p => { if (p.z < z0 || p.y > top || p.y < bot) return false; const u = Math.abs(p.x - F.C.x) / a, w = (p.y - yc) / b, e = u ** 6 + w ** 6; if (e >= 1) return false;
    const xa = a * Math.pow(Math.max(0, 1 - w ** 6), 1 / 6) + m; p.x = F.C.x + Math.sign(p.x - F.C.x || 1) * xa; return true; };
  fn.z0 = z0; fn.top = top; fn.a = a; return fn;
}

// ---------------------------------------------------------------- flows (unit, tangent to the head at p)
export function flow3(F, fl = {}) {
  const C = F.C, type = fl.type || 'drape';
  if (type === 'drape') {
    const pa = (fl.part ?? 0) * Math.PI / 180, m = V(Math.cos(pa), 0, -Math.sin(pa)), back = fl.back ?? 0.3, away = fl.away ?? 0.35, k0 = fl.k0 ?? 0.08, k1 = fl.k1 ?? 0.55;
    return (p, n) => { const q = p.clone().sub(C), l = q.length() || 1, s = Math.sign(q.dot(m)) || 1, ang = Math.abs(q.dot(m)) / l, front = sstep(-0.1, 0.75, q.z / F.rz);
      const k = sstep(k0, k1, ang), v = m.clone().multiplyScalar(s * (1 - k)).add(V(0, -k, -(back * (1 - 0.6 * front)) * k)).addScaledVector(V(0, 0, -1), away * front * (1 - 0.5 * k));
      return proj(v, n) || proj(V(0, -1, -0.2), n) || V(0, -1, 0); };
  }
  if (type === 'sweep') {   // a pixie: the front swept across the forehead to one side (dir +1 = toward the person's left), the rest cropped
    const dir = fl.dir ?? 1, W = F.fromHU(fl.whorl || [0.05, 0.62, -0.55]);
    return (p, n) => { const q = p.clone().sub(C), front = sstep(0.15, 0.75, q.z / F.rz), sd = sstep(0.5, 0.1, n.y), aw = p.clone().sub(W).normalize();
      const crop = aw.multiplyScalar(1 - sd).addScaledVector(V(0, -0.55, -1).normalize(), sd);
      const sw = V(dir, -0.45, 0.3).normalize(), v = crop.multiplyScalar(1 - front).addScaledVector(sw, front * 1.2);
      return proj(v, n) || V(0, -1, 0); };
  }
  return flowFn(F, fl);
}

// the outward normal of the hair volume at p: radial from the skull centre on the head, horizontal from the neck's axis below it
const outOf = F => p => { const a = p.clone().sub(F.C).normalize(), t = sstep(F.chinY + 0.01, F.chinY - 0.05, p.y); if (t <= 0) return a;
  const b = V(p.x, 0, p.z - F.axZ); if (b.lengthSq() < 1e-8) return a; b.normalize(); return a.multiplyScalar(1 - t).addScaledVector(b, t).normalize(); };

// ---------------------------------------------------------------- a guide strand with volume
// P (m): lift, stiff, comb, grav, jit, off0, off1 (the volume offset at the root and once the strand hangs `ramp`), crown (an offset
// the top of the head keeps whatever the hang: the lift of the hair over the crown), cling (above the equator only: `clingY` the
// out.y below which a strand is free), face (a faceWindow), cutY, env, gather, under (a bob's turn-under length)
export function growV3(F, sp, L, P, rnd, flow) {
  const segs = Math.max(2, Math.min(P.maxSeg ?? 30, Math.ceil(L / (P.segLen ?? 0.012)))), ds = L / segs;
  const p = sp.p.clone().addScaledVector(sp.n, 0.0006), pts = [p.clone()];
  const lift = P.lift ?? 0.2; let d = flow(p, sp.n).multiplyScalar(1 - lift).addScaledVector(sp.n, lift).normalize();
  const jit = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(2 * (P.jit ?? 0.1));
  const off0 = P.off0 ?? 0.001, off1 = P.off1 ?? 0.012, ramp = P.ramp ?? 0.08, crown = P.crown ?? 0, stiff = P.stiff ?? 1, comb = P.comb ?? 0.7, grav = P.grav ?? 0.6, cling = P.cling ?? 0;
  const cy0 = P.clingY ?? -0.05, T = P.gather ? F.fromHU(P.gather.to) : null, Tr = P.gather ? (P.gather.r ?? 1.2) / 100 : 0;
  let cut = false; const prev = V(), out = V();
  for (let k = 1; k <= segs; k++) {
    const hang = L * k / segs;
    out.copy(p).sub(F.C).normalize();
    const fl = flow(p, out);
    d.multiplyScalar(stiff).addScaledVector(fl, comb * (1 - 0.5 * k / segs)).addScaledVector(G, grav * hang / 0.1).add(jit).normalize();
    prev.copy(p); p.addScaledVector(d, ds);
    const oy = (p.y - F.C.y) / Math.max(1e-6, p.distanceTo(F.C));
    const off = Math.max(off0 + (off1 - off0) * sstep(0, ramp, hang), crown * sstep(0.1, 0.65, oy) * sstep(0, 0.025, hang));
    // cling only over the top of the head: below the equator the hair hangs from the widest point (lane D clung everywhere above the chin)
    const cl = cling * sstep(cy0, cy0 + 0.35, oy);
    if (cl > 0 && p.y > F.chinY) { const dx = p.x - F.C.x, dy = p.y - F.C.y, dz = p.z - F.C.z, l = Math.hypot(dx, dy, dz), rs = F.rAt(dx / l, dy / l, dz / l);
      if (rs > 0 && l > rs + off) { const l2 = rs + off + (l - rs - off) * (1 - cl), kk = l2 / l; p.set(F.C.x + dx * kk, F.C.y + dy * kk, F.C.z + dz * kk); } }
    F.push(p, off);
    if (P.face) P.face(p);
    if (P.cutY != null && p.y < P.cutY) { const t = (prev.y - P.cutY) / Math.max(1e-6, prev.y - p.y); p.lerpVectors(prev, p, clamp(t)); cut = true; }
    if (P.env) { const e = P.env, q = F.toHU(p), r = Math.hypot(q[0] / e[0], (q[1] - (e[3] ?? 0)) / e[1], q[2] / e[2]); if (r > 1) { const qp = F.toHU(prev), rp = Math.hypot(qp[0] / e[0], (qp[1] - (e[3] ?? 0)) / e[1], qp[2] / e[2]); p.lerpVectors(prev, p, clamp((1 - rp) / Math.max(1e-6, r - rp))); cut = true; } }
    if (T && p.distanceTo(T) < Tr) cut = true;
    const dd = p.clone().sub(prev); if (dd.lengthSq() > 1e-12) d.copy(dd.normalize());
    pts.push(p.clone());
    if (cut) break;
  }
  // a bob's ends turned under: the last `under` metres bend in toward the neck's axis and a little up
  if (P.under && pts.length > 3) { const Lr = arcLen(pts); let s = 0;
    for (let k = 1; k < pts.length; k++) { s += pts[k].distanceTo(pts[k - 1]); const u = sstep(Lr - P.under, Lr, s); if (u <= 0) continue;
      const q = pts[k], ax = V(-q.x, 0, F.axZ - q.z); const l = ax.length(); if (l > 1e-5) q.addScaledVector(ax.divideScalar(l), u * u * P.under * 0.45); q.y += u * u * P.under * 0.2; F.push(q, 0.004); } }
  return { pts, cut };
}

// the cards of a clump: K narrow cards round the guide, converging toward the tip; flyaways from some outer clumps
function clumpCards(ctx, guide, sp, o) {
  const { F, B, rnd } = ctx, n = guide.length; if (n < 2) return 0;
  const outF = outOf(F), S = [0]; for (let k = 1; k < n; k++) S.push(S[k - 1] + guide[k].distanceTo(guide[k - 1])); const Lr = S[n - 1] || 1e-6;
  const fr = guide.map((p, k) => { const d = (k < n - 1 ? guide[k + 1].clone().sub(p) : p.clone().sub(guide[k - 1])).normalize(), up = outF(p); let side = d.clone().cross(up); if (side.lengthSq() < 1e-8) side = V(1, 0, 0); side.normalize(); return { d, side, up: side.clone().cross(d).normalize() }; });
  let made = 0;
  for (let j = 0; j < o.K; j++) {
    const a = rnd() * Math.PI * 2, rho = o.spread * Math.sqrt(0.15 + 0.85 * rnd()), conv = o.conv * (0.7 + 0.5 * rnd()), endT = o.K > 1 ? 0.72 + 0.28 * Math.sqrt(rnd()) : 1;
    let q = [];
    for (let k = 0; k < n; k++) { const t = S[k] / Lr; if (t > endT && q.length >= 2) break; const r = rho * (1 - conv * Math.pow(t, 0.8));
      q.push(F.push(guide[k].clone().addScaledVector(fr[k].side, Math.cos(a) * r).addScaledVector(fr[k].up, Math.sin(a) * r * 0.35), 0.0008)); }
    if (q.length < 2) continue;
    // waves and curls on each card about the SMOOTH guide (the clump shares the phase, so it curls as one), the card's width laid
    // along the smooth guide's side vector
    let sides = null;
    if (o.curl) { q = curlPts(F, q, { ...o.curl, A: o.curl.A * (0.85 + 0.3 * rnd()) }); if (o.face) for (const p of q) o.face(p); sides = q.map((_, k) => fr[Math.min(k, n - 1)].side); }
    const w = o.w0 * (0.75 + 0.5 * rnd()), ua = rnd() * 0.3;
    B.ribbon(q, { tile: o.tile(j), ua, ub: ua + 0.55 + 0.15 * rnd(), w0: w, w1: o.w1 * (0.7 + 0.6 * rnd()), roll: o.rolls ? o.rolls[j % o.rolls.length] + (rnd() - 0.5) * 0.35 : (rnd() - 0.5) * 2 * o.roll * (sides ? 0.3 : 1), depth: o.depth, rand: rnd(), grey: ctx.greyBias(sp.p), out: outF, skin: p => skinBlend(F, sp, p), ...(sides ? { sides } : {}) });
    made++;
  }
  // flyaways: a stray leaves the clump part way down, at an angle out of the hair surface, in a gentle arc
  // (HAIR4, rev 4: a flyaway leaves the clump at a shallow angle and FALLS: its sag grows along it as a cantilever's does, shorter and
  // finer, from the upper part of the clump; the v3 strays rose out of the surface at up to 45 degrees and ran out level)
  if (o.fly > 0 && n > 4) { if (rnd() < o.fly * 0.7) {
    const k0 = 1 + Math.floor(rnd() * Math.max(1, Math.round((n - 3) * 0.55))), p0 = guide[k0].clone(), d0 = fr[k0].d.clone(), up = outF(p0), len = Math.min(cm(rr(rnd, [1.5, 4.5])), 0.3 * Lr), q = [p0.clone()];
    const dir = d0.clone().addScaledVector(up, 0.05 + 0.1 * rnd()).addScaledVector(fr[k0].side, (rnd() - 0.5) * 0.3).normalize(), m = 9;
    for (let s = 1; s <= m; s++) { dir.addScaledVector(G, 0.04 + 0.3 * s / m).normalize(); const pp = q[s - 1].clone().addScaledVector(dir, len / m); F.push(pp, 0.002); if (o.face) o.face(pp); if (o.cutY != null && pp.y < o.cutY) break; q.push(pp); }
    if (q.length >= 3) { B.ribbon(q, { tile: 'fuzz', ua: 0.15, ub: 0.85, w0: cm(0.25), w1: cm(0.15), roll: (rnd() - 0.5) * 1.5, depth: 0, rand: rnd(), grey: ctx.greyBias(sp.p), out: outF, skin: p => skinBlend(F, sp, p), bend: 0.6 }); made++; }
    return made; } }
  if (o.fly > 0 && rnd() < o.fly && n > 4) {
    const k0 = 1 + Math.floor(rnd() * Math.max(1, Math.round((n - 3) * 0.7))), p0 = guide[k0].clone(), d0 = fr[k0].d.clone(), up = outF(p0), len = Math.min(cm(rr(rnd, o.flyLen || [2, 6])), 0.45 * Lr), q = [p0.clone()];
    const dir = d0.clone().multiplyScalar(0.8).addScaledVector(up, 0.15 + 0.3 * rnd()).addScaledVector(fr[k0].side, (rnd() - 0.5) * 0.7).normalize(), m = 6;
    for (let s = 1; s <= m; s++) { dir.addScaledVector(G, 0.08).normalize(); const pp = q[s - 1].clone().addScaledVector(dir, len / m); F.push(pp, 0.002); if (o.face) o.face(pp); if (o.cutY != null && pp.y < o.cutY) break; q.push(pp); }
    if (q.length < 3) return made;
    B.ribbon(q, { tile: 'fuzz', ua: 0.1, ub: 0.9, w0: cm(0.35), w1: cm(0.25), roll: (rnd() - 0.5) * 2, depth: 0, rand: rnd(), grey: ctx.greyBias(sp.p), out: outF, skin: p => skinBlend(F, sp, p), bend: 0.6 });
    made++;
  }
  return made;
}

// ---------------------------------------------------------------- mane: loose hair with volume (and gathered hair with a crown)
function maneLayer(ctx, L, dens, maskIn = null) {
  const { F, rnd, o } = ctx, Fm = FORMS[L.form || ctx.form] || FORMS.straight, fk = Math.pow(Fm.off, L.formVol ?? 0.7);
  const flow0a = flow3(F, { ...(L.flow || {}), to: L.flow?.to || L.gather?.to }), flow0 = ctx.flow7 ? ctx.flow7(flow0a, F) : flow0a, face = L.faceClear === false ? null : faceWindow(F, { ...(L.face || {}) });   // (HAIR7: ctx.flow7, the jagged part's comb)
  // (HAIR5, rev 5) a drape's part divides the TOP of the head only: behind and below the crown the hair falls (the drape combed it away from
  // the part plane all the way to the nape, and a strip of scalp showed down the back of every parted style: L08, L12, L06)
  const flow = L.flow?.type === 'drape' && L.back5 !== false ? (p, nn) => { const f = flow0(p, nn), b = sstep(-0.1, -0.6, (p.z - F.C.z) / F.rz) * sstep(0.55, 0.1, (p.y - F.C.y) / F.ry);
    return b > 0 ? (proj(f.clone().multiplyScalar(1 - b).addScaledVector(V(0, -1, -0.15).normalize(), b), nn) || f) : f; } : flow0;
  const R = L.region, mask = (p, ph, nn) => { let m = maskIn ? maskIn(p, ph, nn) : 1; if (R?.side) m *= sstep(-0.004, 0.004, R.side * (p.x - F.C.x)); if (R?.front != null) m *= sstep(R.front - 0.1, R.front + 0.1, (p.z - F.C.z) / F.rz); return m; };
  const ringK = Fm.kind === 'curl' && Fm.A > 0 && L.curl !== false ? (L.ringClumps5 ?? 2.0) : (L.clumps5 ?? 1.2);   // (HAIR4: more, narrower clumps; HAIR5: more again, and 1.2x the straight / wavy clumps)
  const total = Math.round((L.clumps ?? 500) * (o.density ?? 1) * ringK), shares = L.shares || [0.38, 0.37, 0.25];
  const [cK0, cK1] = L.cards || [2, 4];
  let made = 0, guides = 0, hidden = 0;
  shares.forEach((share, li) => {
    const nL = shares.length, outer = li === nL - 1, inner = nL > 1 && li === 0, depth = nL === 1 ? 0.5 : 1 - li / (nL - 1);
    const roots = sampleRoots(F, dens, Math.round(total * share), rnd, { mask });
    const offK = (inner ? 0.45 : outer ? 1.35 : 0.95) * fk * (L.offK ?? 1);
    for (const sp of roots) {
      let len = cm(rr(rnd, L.len)) * Fm.len * (outer ? 0.92 + 0.16 * rnd() : 0.96 + 0.08 * rnd());
      if (L.taper) { const ys = sp.p.y - F.eyeY, top = sstep(F.earTop - F.eyeY + 0.005, F.earTop - F.eyeY + 0.05, ys), nape = sstep(-0.3, -0.75, (sp.p.z - F.C.z) / F.rz);
        len *= (L.taper.side ?? 1) + (1 - (L.taper.side ?? 1)) * top; len *= 1 - (1 - (L.taper.nape ?? 1)) * nape * (1 - top); }
      if (L.frontLen) len = Math.max(len, cm(L.frontLen) * sstep(0.35, 0.8, (sp.p.z - F.C.z) / F.rz) * Fm.len);
      if (len < 0.004) continue;
      const edge = dens?.dist ? sstep(0.011, 0.0, dens.dist(sp.p, sp.ph)) : 0;
      if (inner && edge > 0.45) continue;
      const P = { lift: clamp((L.lift ?? 0.2) + Fm.lift * (L.formLift ?? 1) + (outer ? 0.06 : 0)) * (1 - 0.9 * edge),   // flat at the hairline (lifted root ends read as teeth) stiff: (L.stiff ?? 1) * Fm.stiff, comb: L.comb ?? 0.7, grav: (L.grav ?? 0.8) * Fm.grav,
        jit: (L.jit ?? 0.08) * (outer ? 1.6 : 1), off0: cm(L.off?.[0] ?? 0.1) * offK, off1: cm(L.off?.[1] ?? 1.6) * offK, ramp: cm(L.ramp ?? 8), crown: cm(L.crown ?? 0.8) * offK, cling: L.cling ?? 0.6, clingY: L.clingY ?? 0.1,
        segLen: cm(L.segLen ?? (Fm.kind === 'curl' && Fm.A > 0 ? 0.6 : 1.4)), maxSeg: L.maxSeg ?? 48, face, gather: L.gather, env: L.env,
        cutY: L.cut?.y != null ? F.eyeY + cm(L.cut.y) + cm(L.cut.jag ?? 0.8) * (rnd() - 0.5) + cm(L.cut.slope ?? 0) * Math.min(1, Math.abs(sp.p.z - F.C.z) / F.rz) * Math.sign(F.C.z - sp.p.z) : null,
        under: L.cut?.under ? cm(L.cut.under) : 0 };
      // (integration v4, HAIR4's finding) the comment mid-line above swallows stiff / comb / grav, so every v3 mane grows on growV3's defaults
      // (stiff 1, comb 0.7, grav 0.6) whatever the style asks; under rev 4 the style's own values apply (o.maneFix false: as HAIR4 shipped)
      if (o.maneFix !== false) { P.stiff = (L.stiff ?? 1) * Fm.stiff; P.comb = L.comb ?? 0.7; P.grav = (L.grav ?? 0.8) * Fm.grav; }
      const g = growV3(F, sp, len, P, rnd, flow);
      let pts = g.pts; if (pts.length < 2) continue;
      // (HAIR7 iteration 3, rev 7: ctx.sub7, v7.js sub7) the guide's long straight runs subdivided: growV3's body push in the BIND pose throws a
      // point out of the raised arm's volume in one step (L08: 1,225 runs of 3-10 cm, L12: 1,977 up to 15 cm), a run the corkscrew, the
      // drape and the settle cannot bend (the straight rays and flat ribbons at the shoulders)
      if (ctx.sub7) pts = ctx.sub7(pts, P.segLen, F);
      // the curl is laid per card in clumpCards (about this smooth guide)
      // (HAIR4, rev 4) curly and coily: the curl lives in the baked tile (a ringlet seen from the side), not in a kinked card: the guide
      // keeps only a slow wave, and each clump is two crossed ringlet cards round it (one faces out of the volume)
      const ring = Fm.kind === 'curl' && Fm.A > 0 && L.curl !== false;
      // (a soft corkscrew at the clump's scale, slower than the tile's loops, so the silhouette is a column of turns, not a strap: its
      // amplitude well under its pitch, so the card never folds, which is what drew the v3 kinks)
      if (ring) { pts = curlPts(F, pts, { A: cm(L.ringWave ?? 0.32) * (0.7 + 0.6 * rnd()), lam: cm(2.6 + 1.4 * rnd()), ph: rnd() * 6.283, kind: 'curl', off: P.off0, ramp: cm(2) }); if (face) for (const p of pts) face(p); }
      const curl = ring ? null : Fm.A > 0 && L.curl !== false ? { A: Fm.A * (L.curlK ?? 1) * (0.8 + 0.4 * rnd()) * (outer ? 1.15 : 1), lam: Fm.lam * (L.lamK ?? 1) * (0.85 + 0.3 * rnd()), ph: rnd() * 6.283, kind: Fm.kind, off: P.off0, ramp: cm(L.curlRamp ?? 2) } : null;
      guides++;
      // the inner layer is the body of the hair (coverage: one wide dense card a clump, shaded deep); the middle and outer layers are
      // clumps of narrow cards (structure), the outer ones with the clump tile and the flyaways
      if (ring) {   // ringlets: the card is as wide as the ringlet (the tile's column is ~2/3 of it), a little narrower toward the tip
        const coil = Fm === FORMS.coily, rw = cm(L.ring ?? (coil ? 0.8 : 1.3)) * (0.75 + 0.5 * rnd()) * (1 - 0.35 * edge) * (L.ring5K ?? 0.7), sgn = rnd() < 0.5 ? -1 : 1;   // (HAIR5: thinner ringlets)
        const tileR = j => inner ? (coil ? 'coily' : 'ringlet') : outer && j === 1 ? (coil ? 'coilyFuzz' : 'curlySparse') : (coil ? 'coil4' : 'ringlet');
        made += clumpCards(ctx, pts, sp, { K: inner ? 1 : 2, spread: inner ? 0 : cm(L.ringSpread ?? 0.2), conv: 0.15, w0: rw * (inner ? 1.5 : 1), w1: rw * (inner ? 1.2 : 0.8), tile: tileR, depth,
          rolls: inner ? [0] : [0, sgn * 1.15], roll: 0, fly: outer ? (L.fly ?? 0.08) : 0, flyLen: L.flyLen, face, cutY: P.cutY != null ? P.cutY - 0.01 : null, curl: null });
        continue; }
      const K = inner ? 1 : Math.max(1, Math.round(cK0 + (cK1 - cK0) * rnd()) - (edge > 0.5 ? 1 : 0));
      const W0 = (L.width ?? [0.75, 0.3]).map(x => cm(x) * Fm.width * (L.width5K ?? 0.8)), wk = (inner ? (L.innerW ?? 1.9) : outer ? 0.8 : 1) * (1 - 0.45 * edge);   // (HAIR5: narrower clump cards)
      const tileOf = j => L.tile || (outer ? (j === 0 ? Fm.outer : Fm.tile) : inner ? Fm.inner : Fm.tile);
      made += clumpCards(ctx, pts, sp, { K, spread: inner ? 0 : cm(L.spread ?? 0.45), conv: L.conv ?? 0.7, w0: W0[0] * wk, w1: W0[1] * wk, tile: tileOf, depth, roll: outer ? (L.roll ?? 0.9) : 0.25,
        fly: outer ? (L.fly ?? 0.08) : 0, flyLen: L.flyLen, face, cutY: P.cutY != null ? P.cutY - 0.01 : null, curl });
    }
  });
  ctx.stats.push({ kind: L.kind, guides, cards: made, hiddenUnderHat: hidden });
}
registerLayer('mane', (ctx, L, dens) => maneLayer(ctx, L, dens));

// face-framing pieces: mane clumps rooted just inside the front hairline at the temples (|azimuth| ph0..ph1 rad), falling beside the face
registerLayer('frame', (ctx, L, dens) => {
  const { F } = ctx, band = cm(L.band ?? 2.2), ph0 = L.ph?.[0] ?? 0.45, ph1 = L.ph?.[1] ?? 1.05;
  const mask = (p, ph) => { const a = Math.abs(ph); return sstep(ph0 - 0.08, ph0 + 0.08, a) * sstep(ph1 + 0.1, ph1 - 0.1, a) * (dens?.dist ? sstep(band, band * 0.4, dens.dist(p, ph)) : 1) * (L.side ? sstep(-0.004, 0.004, L.side * (p.x - F.C.x)) : 1); };
  // the pieces lie against the temple and cheek (cling at every height above the chin, a thin volume): floating a centimetre or two
  // in front of the temple they crossed the eye in any view off the axis
  // soft pieces: a loose wave even on straight hair, the clump tile on every card, curving back toward the ear as they fall
  maneLayer(ctx, { shares: [1], cards: [3, 5], spread: 0.45, conv: 0.85, fly: 0.2, cling: 0.85, clingY: -1.2, off: [0.05, 0.4], crown: 0.2, tile: 'sparse', width: [0.6, 0.25],
    form: ctx.form === 'straight' ? 'wavy' : ctx.form, curlK: 1.2, ...L, kind: 'frame',
    flow: L.flow || { type: 'drape', part: L.part ?? 0, back: 0.45, away: 0.15, k0: 0.0, k1: 0.35 } }, dens, mask);
});

// ---------------------------------------------------------------- coils: defined coily hair at the surface of the volume
// env: [ax, ay, az, yc] (head units, as lane D's afro); each root's clump grows out toward the envelope (radial, a little down, combed by
// an optional flow), then lies along a tight helix: a narrow card per coil (4-6 mm wide), its silhouette bumpy, not a fuzz
registerLayer('coils', (ctx, L, dens) => {
  const { F, B, rnd, o } = ctx, env = L.env || [1.5, 1.38, 1.45, 0.14], n = Math.round((L.clumps ?? 900) * (o.density ?? 1) * (L.clumps5K ?? 2.0)), outF = outOf(F);   // (HAIR5: 2x, thinner)
  const roots = sampleRoots(F, dens, n, rnd), C2 = F.C.clone().add(V(0, env[3] * F.ry, 0)), face = L.faceClear === false ? null : faceWindow(F, { top: 5.0, margin: 2.6, ...(L.face || {}) });
  const EnvR = d => 1 / Math.hypot(d.x / (env[0] * F.rx), d.y / (env[1] * F.ry), d.z / (env[2] * F.rz));
  let made = 0;
  for (const sp of roots) {
    const v2 = sp.p.clone().sub(C2), l2 = v2.length(), low = sstep(F.earTop - F.eyeY - 0.005, F.earTop - F.eyeY - 0.055, sp.p.y - F.eyeY);
    const reach0 = clamp(EnvR(v2.clone().divideScalar(l2)) - l2, 0.012, cm(L.maxLen ?? 8)), reach = reach0 * (1 - low) + Math.min(reach0, cm(L.nape ?? 2.2)) * low;
    // (HAIR5, rev 5) short at the back and sides below the ear's top (a band, not a step): 10 cm coils behind the ear hung as spikes to the collar
    const reach5 = Math.min(reach, cm(L.nape ?? 2.2) + Math.max(0, reach - cm(L.nape ?? 2.2)) * sstep(F.earTop - F.eyeY - 0.02, F.earTop - F.eyeY + 0.05, sp.p.y - F.eyeY));
    const sh = L.shell ? rr(rnd, L.shell) : 0.75 + 0.25 * rnd(), len = reach5 * sh * (1.05 + 0.25 * rnd());
    const front = sstep(0.3, 0.75, (sp.p.z - F.C.z) / F.rz) * sstep(0.0, 0.04, sp.p.y - F.eyeY - 0.03);   // the front hairline's coils stand up and out
    const dOut = outF(sp.p).addScaledVector(G, (L.droop ?? 0.25) * (1 - front)).addScaledVector(V(0, 1, 0), 0.35 * front).addScaledVector(V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5), 0.5).normalize();
    const m = Math.max(6, Math.round(len / cm(0.25))), q = [sp.p.clone().addScaledVector(sp.n, 0.001)];
    for (let s = 1; s <= m; s++) { const pp = q[s - 1].clone().addScaledVector(dOut, len / m); F.push(pp, 0.003 * s / m); if (face) face(pp); q.push(pp); }
    {   // (HAIR4) the coil is in the baked tile: a narrow card per coil with only a slow wiggle (straight cards stood out as
      // spikes), any roll; a third of them the fuzzy mass
      const w = cm(L.w5 ?? 0.3) * (0.8 + 0.4 * rnd()), fz = rnd() < 0.3;
      const qq = curlPts(F, q.slice(0, Math.max(3, Math.round(q.length * 0.85))), { A: cm(0.14) * (0.6 + 0.8 * rnd()), lam: cm(1.4 + 0.8 * rnd()), ph: rnd() * 6.283, kind: 'curl', off: 0.002, ramp: cm(0.5) }); q.length = 0; q.push(...qq);
      B.ribbon(q, { tile: fz ? 'coilyFuzz' : 'coil4', ua: 0.1 * rnd(), ub: 0.9 + 0.1 * rnd(), w0: w * (fz ? 1.6 : 1), w1: w * (fz ? 1.3 : 0.85), taper: 1, roll: (rnd() - 0.5) * 3.2, depth: 1 - sh, rand: rnd(), grey: ctx.greyBias(sp.p), out: outF, bend: 0.85, skin: p => skinBlend(F, sp, p) });
      made++; }
  }
  ctx.stats.push({ kind: 'coils', coils: made });
});

// ---------------------------------------------------------------- braids (box braids / twists) and locs on mane guides
// ---------------------------------------------------------------- HAIR4 (rev 4): ropes that HANG
// Judge c9: 'braids as stiff spokes'. Why: a rope was grown like a strand (stiffness carried its direction on) and pushed out of the body
// RADIALLY from the neck's axis (field.js push); at the shoulder line the envelope's radius jumps from the neck to the shoulder within a
// few centimetres, so a braid there was thrown out level, kept that heading, and ended in the air beside the arm. A rope is instead
// SETTLED: the grown path is the start; the root is fixed and its first few centimetres held to the grown direction (the part and the
// volume at the roots); every other point falls under gravity, the links stay their length (follow-the-leader), a little bending
// stiffness smooths it, and each point is pushed out of the skull and the neck / shoulder / back envelope; a comb bias sends each rope to
// the back of the shoulders (or, for some rooted in front of the ear, to the front), as hair over a shoulder slides off it front or back
// instead of sliding out to the shoulder's tip. Ropes lie in a few layers (a per-rope offset), so the pile has depth. The skin weights
// follow where a rope RESTS: the root's (head) until it reaches the body, then the body's own weights at the contact (shoulder, back or
// chest move it), carried down the part that hangs free; the free part's sway weight rises toward the tip (aSway, for a motion pass).
function bodyWeights(F) {
  if (F._bodyW) return F._bodyW;
  const h = F.h, g = h.body.geometry, P = g.attributes.position.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = P.length / 3, cell = 0.03, grid = new Map(), y1 = F.chinY + 0.01;
  const AH = h.aHero, okR = (r, y) => r === REG.torso || r === REG.neck || r === REG.pelvis || (r === REG.uarm && y > F.shY - 0.06);   // the envelope's parts: never the arm below the shoulder cap
  for (let v = 0; v < n; v++) { const y = P[v * 3 + 1]; if (y > y1 || y < F.nk.y - 0.5 || !okR(AH[v * 4], y)) continue; const k = `${Math.floor(P[v * 3] / cell)},${Math.floor(y / cell)},${Math.floor(P[v * 3 + 2] / cell)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); }
  const near = p => { const a = Math.floor(p.x / cell), b = Math.floor(p.y / cell), c = Math.floor(p.z / cell); let best = -1, bd = 1e9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const L = grid.get(`${a + i},${b + j},${c + k}`); if (!L) continue; for (const v of L) { const d = (P[v * 3] - p.x) ** 2 + (P[v * 3 + 1] - p.y) ** 2 + (P[v * 3 + 2] - p.z) ** 2; if (d < bd) { bd = d; best = v; } } }
    return best < 0 ? null : { d: Math.sqrt(bd), si: [SI[best * 4], SI[best * 4 + 1], SI[best * 4 + 2], SI[best * 4 + 3]], sw: [SW[best * 4], SW[best * 4 + 1], SW[best * 4 + 2], SW[best * 4 + 3]] }; };
  return (F._bodyW = near);
}
const mixW = (a, b, t) => { const acc = new Map(); a[0].forEach((s, k) => { if (a[1][k] > 0) acc.set(s, (acc.get(s) || 0) + a[1][k] * (1 - t)); }); b[0].forEach((s, k) => { if (b[1][k] > 0) acc.set(s, (acc.get(s) || 0) + b[1][k] * t); });
  const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((q, e) => q + e[1], 0) || 1, si = [0, 0, 0, 0], sw = [0, 0, 0, 0]; top.forEach((e, k) => { si[k] = e[0]; sw[k] = e[1] / sum; }); return [si, sw]; };
export function settleRope(F, pts0, { off = 0.004, iters = 110, bend = 0.12, hold = 0.05, side = -1, bias = 0.008, inward = 0.004, grav = 0.004, fric = 1, keep = null, base = 0 } = {}) {
  const L = arcLen(pts0), n = Math.max(4, pts0.length), X = resamplePts(pts0, n), X0 = X.map(p => p.clone()), ds = L / (n - 1);
  // (HAIR7 rev 7, v7.js rope7: the first `base` m, the base laid along the scalp, held whole; the hold's ramp starts where it ends)
  const S = X0.map((_, k) => k * ds), hk = base > 0 ? S.map(s => s <= base ? 1 : sstep(base + hold, base + hold * 0.3, s)) : S.map(s => sstep(hold, hold * 0.3, s)), tmp = V(), y0 = F.chinY - 0.015, y1 = F.shY - 0.04, nr = 0.07;
  for (let it = 0; it < iters; it++) {
    // gravity; on the shoulder (below the jaw, above the shoulder line, outside the neck) the comb sends the rope front or back and a
    // little in toward the neck, so it slides off the trapezius instead of out along it to the arm; below the shoulder it only falls
    for (let k = 1; k < n; k++) { const p = X[k]; p.y -= grav; if (p.y > y0 || p.y < y1) continue; const ax = p.x - F.C.x, on = sstep(nr, nr + 0.04, Math.abs(ax)) * sstep(y0, y0 - 0.04, p.y);
      p.z += side * bias * on; p.x -= Math.sign(ax) * inward * on; }
    for (let k = 1; k < n; k++) if (hk[k] > 0) X[k].lerp(X0[k], hk[k]);
    // friction on the shoulder: a rope resting there does not slide OUT along it (only down, front or back)
    for (let k = 1; k < n; k++) { const p = X[k], r0 = Math.hypot(p.x - F.C.x, p.z - F.axZ); ropePush(F, p, off);
      if (fric && p.y < y0 && p.y > y1) { const r1 = Math.hypot(p.x - F.C.x, p.z - F.axZ), ax = p.x - F.C.x; if (Math.abs(ax) > nr + 0.03 && Math.abs(p.z - F.axZ) < 0.05 && r1 > r0) { const k2 = (r0 + 0.25 * (r1 - r0)) / r1; p.x = F.C.x + ax * k2; p.z = F.axZ + (p.z - F.axZ) * k2; ropePush(F, p, off); } } }   // (the shoulder's top only: on the back it made a ring)
    if (keep) for (let k = 1; k < n; k++) keep(X[k]);   // (HAIR7, rev 7: v7.js brow7, the forehead and temples kept clear)
    for (let k = 2; k < n; k++) { tmp.copy(X[k - 1]).multiplyScalar(2).sub(X[k - 2]).sub(X[k]); X[k].addScaledVector(tmp, bend); }
    for (let k = 1; k < n; k++) { tmp.copy(X[k]).sub(X[k - 1]); const l = tmp.length() || 1; X[k].copy(X[k - 1]).addScaledVector(tmp, ds / l); }
    if (keep) for (let k = 1; k < n; k++) keep(X[k]);
  }
  for (let k = 1; k < n; k++) ropePush(F, X[k], off * 0.9);
  if (keep) for (let k = 1; k < n; k++) keep(X[k]);
  return X;
}
// out of the skull (as field.js push) and out of the neck / shoulder / back envelope ALONG ITS NORMAL: on the shoulder's top the envelope's
// radius grows fast as y falls, so its normal points up and a rope resting there is lifted onto it, not thrown out level (field.js
// pushes radially from the neck's axis, right for a vertical surface, which is what made the spokes)
function ropePush(F, p, off) {
  const dx = p.x - F.C.x, dy = p.y - F.C.y, dz = p.z - F.C.z, l = Math.hypot(dx, dy, dz);
  if (l > 1e-6 && p.y > F.chinY - 0.02) { const r = F.rAt(dx / l, dy / l, dz / l); if (r > 0 && l < r + off) { const k = (r + off) / l; p.set(F.C.x + dx * k, F.C.y + dy * k, F.C.z + dz * k); } }
  if (p.y < F.eyeY - 0.02) { const br = F.bodyR(p.x, p.y, p.z), x = p.x, z = p.z - F.axZ, rho = Math.hypot(x, z);
    if (br > 0 && rho < br + off) { const g = (F.bodyR(p.x, p.y + 0.01, p.z) - F.bodyR(p.x, p.y - 0.01, p.z)) / 0.02, k = 1 / (1 + g * g), d = br + off - rho, rr = Math.max(rho, 1e-6);
      p.x += x / rr * d * k; p.z += z / rr * d * k; p.y -= g * d * k; } }
  return p;
}
function ropeWeights(F, sp, pts, r) {
  const near = bodyWeights(F), W = [], sway = []; let carry = null, contactAt = -1, s = 0;
  for (let k = 0; k < pts.length; k++) { if (k) s += pts[k].distanceTo(pts[k - 1]);
    const base = skinBlend(F, sp, pts[k]), below = pts[k].y < F.chinY - 0.015, b = below ? near(pts[k]) : null;
    if (b && b.d < r + 0.035) { const t = sstep(r + 0.035, r + 0.012, b.d) * sstep(F.chinY - 0.015, F.chinY - 0.05, pts[k].y); carry = t > 0.5 ? [b.si, b.sw] : carry; contactAt = s; W.push(mixW(base, [b.si, b.sw], t)); }
    else if (carry && below) W.push(mixW(base, carry, 0.85)); else W.push(base);
    sway.push(contactAt < 0 ? sstep(F.chinY, F.chinY - 0.1, pts[k].y) * 0.5 : Math.min(1, (s - contactAt) / 0.25)); }
  // smooth along the rope (no kink in the weights where a contact starts)
  const out = W.map((w, k) => { let acc = w; for (const j of [k - 2, k - 1, k + 1, k + 2]) if (j >= 0 && j < W.length) acc = mixW(acc, W[j], 0.2); return acc; });
  return { W: out, sway };
}

function ropes(ctx, L, dens, kind) {
  const { F, B, rnd, o } = ctx, n = Math.round((L.count ?? 110) * (o.density ?? 1)), r0 = cm(L.r ?? 0.42), flow = flow3(F, L.flow || { type: 'drape', part: 0 });
  // (HAIR7 c4 it1, ctx.box7 = v7.js box7, since c5 it 9 the behaviour, no switch) box braids / loc sections: the scalp parted into boxes, one rope per box rooted at
  // its centre (else blue-noise roots, as before)
  const bx = ctx.box7 ? ctx.box7(L, n, rnd) : null, BX = ctx.boxG; if (bx) F._box7 = bx;   // (F._box7: the parting grid, for the node checks)
  const face0 = L.faceClear === false ? null : faceWindow(F, { margin: 2.8, ...(L.face || {}) }), roots = bx ? bx.roots : sampleRoots(F, dens, n, rnd);
  // (HAIR7: with rope7 the face window works inside the settle too, as a collider: rev 6 applied it only after the settle, a right-angle
  // jog at its edge)
  const keep = ctx.rope7 && face0 ? face0 : null, face = keep || face0;
  // (HAIR7 c2 it4, ctx.rope7, v7.js: a front rope's base laid along the scalp by its comb to where it falls clear of the face; the face
  // window then works inside the settle as a collider; the clearance is the window's half-width plus the rope)
  let nb7 = 0, lb7 = 0; const b7 = ctx.rope7 || null, xClear = face0 ? face0.a + cm(0.25) : Math.abs(F.eL.x - F.C.x) + cm(3);
  let made = 0, nG = 0;
  // (HAIR4, rev 4) a centre part divides the TOP of the head; behind and below the crown the hair falls (the drape flow combed the back
  // ropes sideways from the part all the way to the nape, and they crossed the shoulders to the arms)
  const flowR = (p, nn) => { const f = flow(p, nn), b = sstep(0.0, -0.55, (p.z - F.C.z) / F.rz) * sstep(0.5, 0.05, (p.y - F.C.y) / F.ry);
    return b > 0 ? (proj(f.clone().multiplyScalar(1 - b).addScaledVector(V(0, -1, -0.15).normalize(), b), nn) || f) : f; };
  // (HAIR7 c5 it11) two passes: every rope grown and settled first, then the hanging ropes cohere into bundles (ctx.cohere7, v7.js),
  // then each is weighted and built
  const recs = [];
  for (const sp of roots) {
    const r = r0 * (0.85 + 0.3 * rnd()), len = cm(rr(rnd, L.len || [30, 40]));
    const base = b7 ? b7(sp, { off: r * 1.15, total: len, xClear: xClear + r * 1.5, flow, step: cm(L.segLen ?? 0.9) }) : null;
    if (base) { nb7++; lb7 += base.len; (F._rope7 ||= []).push(base.pts.map(q => [q.x, q.y, q.z])); }   // (F._rope7: the bases, for the node checks)
    const g = growV3(F, base ? { ...sp, p: base.end, n: base.n } : sp, base ? len - base.len : len, { lift: L.lift ?? 0.35, stiff: L.stiff ?? 0.9, comb: L.comb ?? 0.8, grav: L.grav ?? 1.0, jit: 0.1, off0: r * 1.1, off1: r * (L.vol ?? 4), ramp: cm(6), crown: r * (L.crownK ?? 2.2),
      cling: L.cling ?? 0.5, clingY: 0.15, segLen: cm(L.segLen ?? 0.9), maxSeg: 70, face, gather: L.gather, cutY: L.cut?.y != null ? F.eyeY + cm(L.cut.y) + cm(1.5) * (rnd() - 0.5) : null }, rnd, flowR);
    let pts = base ? base.pts.concat(g.pts.slice(1)) : g.pts; if (pts.length < 3) continue;
    // settled: hangs, rests on the shoulders and back
    const front = (sp.p.z - F.C.z) / F.rz, toFront = front > 0.25 && rnd() < (L.frontShare ?? 0.45);
    const lay = r * (1.15 + (L.layers ?? 2.2) * rnd() + 1.2 * sstep(-0.2, 0.6, (sp.p.y - F.C.y) / F.ry));
    pts = settleRope(F, pts, { off: lay, side: toFront ? 1 : -1, hold: cm(L.hold ?? 3), iters: L.iters ?? 220, ...REV5_ROPE, ...(o.rope5 || {}), ...(keep ? { keep } : {}), ...(base ? { base: base.len } : {}) });
    for (const p of pts) { if (face) face(p); }
    recs.push({ sp, r, pts, lay });
  }
  const co7 = ctx.cohere7 ? ctx.cohere7(recs, ropePush) : null;
  if (co7 && face) for (const q of recs) for (const p of q.pts) face(p);
  F._ropes7 = () => recs.map(q => q.pts.map(p => [p.x, p.y, p.z]));   // (the settled ropes, for the node checks)
  for (const { sp, r, pts } of recs) {
    let skinAt = p => skinBlend(F, sp, p), sway = null, rT = t => r * (t < 0.03 ? 0.55 + 0.45 * t / 0.03 : 1 - 0.22 * t);
    {   // tapers to the end (rT), the body's weights where it rests
      const RW = ropeWeights(F, sp, pts, r), map = new Map(pts.map((p, k) => [p, RW.W[k]])); skinAt = p => map.get(p) || skinBlend(F, sp, p); sway = RW.sway;
      const tp = L.taper ?? 0.45; rT = t => r * (t < 0.03 ? 0.55 + 0.45 * t / 0.03 : 1 - tp * Math.pow(t, 1.4)); }
    const ph = rnd() * 6.28, outP = p => p.clone().sub(nearestOn(pts, p)).normalize();
    if (kind === 'braid') {
      const lam = cm(L.stitch ?? 1.3);   // a three-lobed section turning along the braid: the plait's over-under seen as relief
      // the tile: the v3 atlas's box-braid relief, in the 'net' slot (atlas.js; the v1 net is the snood's); one chevron pair per stitch
      // (c4 it1, box: a THREE-STRAND PLAIT's relief, v7.js plait7r, at REV7.box.sides; the tube's random carries the 'net' slot so
      // person_hair.py plaits its fibres)
      B.tube(pts, { tile: 'net', r: rT, rTh: BX.plait7r(lam, ph), sides: BX.sides, depth: 0.25, rand: (15 + 0.999 * rnd()) / 16, grey: ctx.greyBias(sp.p), vScale: lam, skin: skinAt, out: outP, ...(sway ? { sway } : {}) });
      // the tail end: a short loose brush below the last stitch (rev 4: finer, the end's own weights)
      const e = pts.at(-1), dE = e.clone().sub(pts.at(-2)).normalize(), rE = rT(1), skE = skinAt(e), swE = sway ? sway.at(-1) : 0;
      for (let c = 0; c < 3; c++) { const s0 = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(rE); B.ribbon([e.clone().add(s0), e.clone().addScaledVector(dE, cm(1.6)).add(s0.multiplyScalar(2))], { tile: 'curlySparse', w0: rE * 2.2, w1: rE * 1.6, roll: rnd() * 3, depth: 0.3, rand: rnd(), grey: 0, out: () => dE, skin: () => skE, sway: swE }); }
    } else {
      const lumpy = (th, t, s) => 1 + 0.12 * Math.sin(s * 180 + ph) + 0.06 * Math.sin(th * 3 + s * 90);
      B.tube(pts, { tile: 'loc', r: rT, rTh: lumpy, sides: 7, depth: 0.3, rand: (11 + 0.999 * rnd()) / 16, grey: ctx.greyBias(sp.p), vScale: 0.04, skin: skinAt, out: outP, ...(sway ? { sway } : {}) });
    }
    // (c4 it1, box) the box's own hair, combed taut on the skin from the box's edges into the rope's start (the partings stay bare)
    if (bx && bx.boxes[sp.box]) { const bxo = bx.boxes[sp.box], gk = BX.gather7(F, bxo, r, bx.cellMm), gs = [sp.si, sp.sw];
      for (const gc of gk) { const ua = 0.5 * rnd(); B.ribbon(gc.pts, { tile: 'dense', ua, ub: ua + 0.5, w0: gc.w0, w1: gc.w1, roll: 0, depth: 0.15, rand: rnd(), grey: ctx.greyBias(sp.p), out: p => p.clone().sub(F.C).normalize(), bend: 0.85, skin: () => gs }); }
      nG += gk.length; }
    // a little fuzz off the rope (new growth and flyaways)
    // (HAIR7 c6 it 2, the behaviour: ROOTED WISPS) the tail's loose brush and the fuzz are the rope's own fibres escaping the plait, so they
    // move with the rope: the rope's skin weights and sway AT THEIR ROOT on it. Until now they took the head's blend (skinBlend) while the
    // rope that rests on the shoulders and back took the body's (ropeWeights), so in any pose but the rest the head carried them off the
    // braid: the curled wisps hanging in the air beside the braids in the Cycles renders (060212), rootless
    for (let c = 0; c < (L.fuzz ?? 2); c++) { const k = 1 + Math.floor(rnd() * (pts.length - 2)), a = pts[k], b = pts[Math.min(pts.length - 1, k + 1)], side = b.clone().sub(a).cross(outP(a)).normalize(), skA = skinAt(a);
      B.ribbon([a.clone().addScaledVector(side, r * 0.8), b.clone().addScaledVector(side, r * 1.7)], { tile: 'fuzz', w0: cm(0.35), w1: cm(0.25), roll: rnd() * 3, depth: 0, rand: rnd(), grey: 0, out: () => side, skin: () => skA, sway: sway ? sway[k] : 0 }); }
    made++;
  }
  ctx.stats.push({ kind, ropes: made, ...(co7 ? { cohere7: co7 } : {}), ...(b7 ? { base7: nb7, base7cm: +(lb7 * 100 / Math.max(1, nb7)).toFixed(1) } : {}),
    ...(bx ? { box7: { boxes: bx.boxes.length, rows: bx.rows, boxCm: +(bx.W * 100).toFixed(2), merged: bx.merged, miss: bx.miss, gather: nG, cellMm: +bx.cellMm.toFixed(2) } } : {}) });
}
registerLayer('braids', (ctx, L, dens) => ropes(ctx, L, dens, 'braid'));
registerLayer('locs3', (ctx, L, dens) => ropes(ctx, L, dens, 'loc'));

// ---------------------------------------------------------------- the hairline's fringe for v3 styles (lane D's fringe, combed by the
// v3 flows: lane D's flowFn has no 'drape' and combed it straight down the forehead). Short fine hairs in a band inside the line,
// lying flat with the style's own comb: the hairline is a density ramp, not an edge (fringe4 below).
registerLayer('fringe3', (ctx, L, dens) => {
  const { F, B, rnd, o, style } = ctx, src = (style?.layers || []).find(l => l.kind === 'mane' || l.kind === 'scalp' || l.kind === 'guides') || {};
  if (!dens?.line) return;
  const band = cm(L.band ?? 1.0), flow = flow3(F, { ...(src.flow || { type: 'back' }), to: src.flow?.to || src.gather?.to });
  return fringe4(ctx, L, dens, flow);
});

// ---------------------------------------------------------------- HAIR4 (rev 4): the hairline as a density ramp at 1:1
// A real hairline has no edge: going out from the scalp, the terminal hairs thin and shorten, intermediate hairs, then vellus a few
// millimetres onto the forehead and temples. Roots are drawn across a band that straddles the line (from `out` cm outside it to `band`
// cm inside), with a density that rises across it, and each hair's length and coverage follow its place in the band: vellus outside the
// line (the baked vellus tile: fine, short, sparse), short fine hairs at it, longer inside (the scalp's own cards take over).
function fringe4(ctx, L, dens, flow) {
  const { F, B, rnd, o } = ctx, band = cm(L.band4 ?? 1.4), out = cm(L.out4 ?? 0.6), outF = outOf(F);
  const d4 = (p, ph) => { const e = dens.dist(p, ph); return sstep(-out, out * 0.35, e) * (0.35 + 0.65 * sstep(-out * 0.3, band * 0.5, e)) * sstep(band, band * 0.6, e) * dens.extra(p); };
  const roots = sampleRoots(F, d4, Math.round((L.count5 ?? 760) * (o.density ?? 1)), rnd);   // (HAIR5: denser, finer)
  let made = 0;
  for (const sp of roots) {
    const e = dens.dist(sp.p, sp.ph), inK = sstep(-out * 0.4, band * 0.7, e), len = cm(0.25 + 1.2 * inK) * (0.6 + 0.8 * rnd());
    const g = growV3(F, sp, len, { lift: 0.06, stiff: 0.8, comb: 0.9, grav: 0.1, jit: 0.2, off0: 0.0003, off1: 0.0009, ramp: 0.01, cling: 0.92, clingY: -1, segLen: 0.0025, maxSeg: 7 }, rnd, flow);
    if (g.pts.length < 2) continue;
    const w = cm(0.12 + 0.12 * inK) * 0.85;
    B.ribbon(g.pts, { tile: 'vellus', ua: rnd() * 0.5, ub: 0.5 + 0.5 * rnd(), w0: w, w1: w * 0.7, roll: (rnd() - 0.5) * 0.4, depth: 0.1, rand: rnd(), grey: ctx.greyBias(sp.p), out: outF, bend: 0.8, skin: p => skinBlend(F, sp, p) });
    made++;
  }
  ctx.stats.push({ kind: 'fringe4', clumps: made });
}
