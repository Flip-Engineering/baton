// HAIR / styles: our small JSON groom format, read into cards (HUMAN c8 lane D).
//
// A style (assets/hair/styles/<name>.json) is a hairline, a scalp base and a list of layers. Lengths and offsets are cm; points are
// HEAD UNITS (x / rx, (y - Cy) / ry, (z - Cz) / rz about the skull centre, field.js), so one file fits every head.
//   { "name": "w_tail_low", "label": "...", "sex": "f", "forms": ["straight", "wavy", ...],
//     "hairline": { front, temple, side, nape, recede, crown, thin, band, soft },        (cm; see grow.js hairlineFn)
//     "base": 0.9,                       the scalp's dark root base under the cards (0 bare scalp between cornrows)
//     "shave": 0,                        follicle stubble on the scalp (buzz, a shaved head's shadow)
//     "layers": [ ... ] }
// Layer kinds:
//   scalp     roots over the hairline's area, each clump grown along a comb flow: { flow: { type, part, to, whorl, swirl }, len: [a, b],
//             taper: { side, nape } (length multipliers below the crown: short back and sides), clumps, lift, comb, grav, stiff,
//             off: [root, volume], width: [root, tip], depth: n sub-layers, region: { ph: [deg, deg], y: [cm, cm] }, cut: { y } | env:
//             [ax, ay, az, yc], gather: { to, r }, tile }
//   guides    the same roots, shaped by the nearest of a few hand-written guide polylines: { guides: [ { pts: [[hu]...] } ], pin }
//   tail      a tie at `at`, a rope hanging from it under gravity on the back, its clumps spread in the rope's section: { at, dir, len, r: [a, b], clumps, plait }
//   bun       { at, size: [x, y, z] (cm), clumps, form }
//   roll      a roll of hair along a path (the 1940s rolled front, a victory roll at the nape): { path: [[hu]...], r, clumps }
//   pincurls  flat spirals on the scalp: { at: [[hu]...], r }
//   cornrows  plaits lying on the scalp from the front hairline to the nape: { rows, spread (deg), r, ends: { len } }
//   locs      tubes from scalp roots: { count, len: [a, b], r }
//   puff      a coily ball (a puff or a gathered afro): { at, size }
//   wrap      a cloth over the hair (bandana, turban, snood, headwrap; wraps.js): { kind, color, pattern, ... }
// Hair FORM (straight, wavy, curly, coily) is applied on top of any style (the lab's styles x forms grid): it sets the tile, the
// wave or curl (amplitude and period after Loussouarn et al. 2007's curve-diameter scale, "Worldwide diversity of hair curliness",
// Int J Dermatol 46 S1:2-6: from straight to tight coils of a few mm), the volume and the shrinkage of the visible length.
import * as THREE from 'three';
import { sstep, mulberry } from './field.js';
import { V, clamp, sampleRoots, hairlineFn, flowFn, growStrand, guideStrand, curlPts, skinBlend, resamplePts, arcLen } from './grow.js';

export const FORMS = {
  straight: { tile: 'straight', outer: 'sparse', inner: 'dense', A: 0, lam: 0.05, kind: 'wave', off: 1, len: 1, lift: 0, grav: 1, stiff: 1, width: 1 },
  wavy: { tile: 'wavy', outer: 'sparse', inner: 'wavy', A: 0.0045, lam: 0.045, kind: 'wave', off: 1.35, len: 0.95, lift: 0.05, grav: 0.9, stiff: 1, width: 1 },
  curly: { tile: 'curly', outer: 'curly', inner: 'curly', A: 0.006, lam: 0.022, kind: 'curl', off: 2.0, len: 0.72, lift: 0.18, grav: 0.55, stiff: 1.05, width: 1.25, cling: 0.7 },
  coily: { tile: 'coily', outer: 'coilyFuzz', inner: 'coily', A: 0.0028, lam: 0.007, kind: 'curl', off: 2.8, len: 0.5, lift: 0.4, grav: 0.12, stiff: 1.3, width: 1.4, cling: 0.4 },
};

// ---------------------------------------------------------------- loading
let _styles = null;
export async function loadHairStyles(base = new URL('../../../assets/hair/styles/', import.meta.url).href) {
  if (_styles) return _styles;
  const index = await fetch(base + 'index.json').then(r => r.json());
  const all = await Promise.all(index.styles.map(n => fetch(base + n + '.json').then(r => r.json())));
  _styles = Object.fromEntries(all.map(s => [s.name, s]));
  return _styles;
}

// ---------------------------------------------------------------- layer builders
// ctx: { F, B (CardBuilder), rnd, form, o (groom options), stats, out (outward fn), skin(sp)(p) }
const cm = x => x / 100;
const rr = (rnd, a) => Array.isArray(a) ? a[0] + (a[1] - a[0]) * rnd() : a;

function regionMask(F, R) { if (!R) return null; return (p, ph) => { const aph = Math.abs(ph) * 180 / Math.PI, ys = (p.y - F.eyeY) * 100;
  let d = 1; if (R.ph) d *= sstep(R.ph[0] - 6, R.ph[0] + 6, aph) * sstep(R.ph[1] + 6, R.ph[1] - 6, aph); if (R.y) d *= sstep(R.y[0] - 0.6, R.y[0] + 0.6, ys) * sstep(R.y[1] + 0.6, R.y[1] - 0.6, ys);
  if (R.side) d *= sstep(-0.004, 0.004, R.side * p.x); return d; }; }

// a length map: the style's length at the top, shorter down the sides and nape (clippers)
function lenAt(F, L, p, rnd) { let l = rr(rnd, L.len); if (L.taper) { const ys = p.y - F.eyeY, top = sstep(F.earTop - F.eyeY + 0.01, F.earTop - F.eyeY + 0.05, ys);
  const nape = sstep(-0.3, -0.75, (p.z - F.C.z) / F.rz) * sstep(F.earTop - F.eyeY + 0.03, F.earTop - F.eyeY - 0.01, ys);
  l *= (L.taper.side ?? 1) + (1 - (L.taper.side ?? 1)) * top; l *= 1 - (1 - (L.taper.nape ?? 1)) * nape; } return cm(l); }

function scalpLayer(ctx, L, dens) {
  const { F, B, rnd, o } = ctx, Fm = FORMS[L.form || ctx.form] || FORMS.straight;
  const flowA = flowFn(F, { ...(L.flow || {}), to: L.flow?.to || L.gather?.to }), flow = ctx.flow7 ? ctx.flow7(flowA, F) : flowA;   // (HAIR7: ctx.flow7, the jagged part's comb)
  const mask = regionMask(F, L.region), nSub = L.depth ?? 3, total = Math.round((L.clumps ?? 600) * (o.density ?? 1) * (L.formClumps === false ? 1 : 1 / Math.sqrt(Fm.width)) * (Fm.kind === 'curl' ? 1.6 : 1) * (L.clumps5K ?? 1.5));   // (HAIR5: 1.5x, narrower: a crop of fine tufts, not planks)
  const guides = L.guides ? L.guides.map(g => { const pts = g.pts.map(a => F.fromHU(a)); const root = F.onScalp(g.pts[0], 0.0006); pts[0] = root.clone(); return { root, pts }; }) : null;
  const shares = nSub === 1 ? [1] : nSub === 2 ? [0.6, 0.4] : [0.42, 0.36, 0.22];
  let made = 0, hidden = 0;
  shares.forEach((share, li) => {
    const outer = li === shares.length - 1 && nSub > 1, inner = li === 0 && nSub > 1, depth = nSub === 1 ? 0.5 : 1 - li / (shares.length - 1);
    const roots = sampleRoots(F, dens, Math.round(total * share), rnd, { mask });
    const offK = (inner ? 0.45 : outer ? 1.45 : 1) * Fm.off * (L.offK ?? 1);
    for (const sp of roots) {
      let len = lenAt(F, L, sp.p, rnd) * Fm.len * (L.formLen === false ? 1 : 1) * (outer ? 0.9 + 0.25 * rnd() : 1);
      if (len < 0.002) continue;
      // at the hairline a clump starts narrow and lies flat (a card's full root width there drew the line as a row of stamped edges)
      const edge = dens?.dist ? sstep(0.011, 0.0, dens.dist(sp.p, sp.ph)) : 0;
      if (inner && edge > 0.45) continue;                     // the wide inner cards stay off the line: outer cards and the fringe draw it
      const P = { cling: (L.cling ?? 0.6) * (Fm.cling ?? 1), lift: clamp((L.lift ?? 0.15) + Fm.lift * (L.formLift ?? 1) + (outer ? 0.08 : 0)) * (1 - 0.7 * edge), stiff: (L.stiff ?? 1) * Fm.stiff, comb: L.comb ?? 0.7, grav: (L.grav ?? 0.6) * Fm.grav, jit: (L.jit ?? 0.1) * (outer ? 1.8 : 1),
        off0: cm(L.off?.[0] ?? 0.12) * offK, off1: cm(L.off?.[1] ?? 0.5) * offK, segLen: cm(L.segLen ?? 1.1), maxSeg: L.maxSeg ?? 24, gather: L.gather, env: L.env, hatMargin: cm(L.hatMargin ?? 0.25),
        cutY: L.cut?.y != null ? F.eyeY + cm(L.cut.y) + cm(0.8) * (rnd() - 0.5) : null };
      const g = guides ? guideStrand(F, sp, guides, { ...P, pin: L.pin ?? 0 }, rnd) : growStrand(F, sp, len, P, rnd, flow);
      if (g.hidden && !o.keepHidden) { hidden++; continue; }
      let pts = g.pts; if (pts.length < 2) continue;
      // (HAIR4, rev 4: curly and coily curls are in the baked tiles; the card keeps a third of the geometric curl, as a wave of the clump)
      if (Fm.A > 0 && L.curl !== false) pts = curlPts(F, pts, { A: Fm.A * (L.curlK ?? 1) * (0.8 + 0.4 * rnd()) * (Fm.kind === 'curl' ? 0.3 : 1), lam: Fm.lam * (0.85 + 0.3 * rnd()) * (Fm.kind === 'curl' ? 2.5 : 1), ph: rnd() * 6.283, kind: Fm.kind === 'curl' ? 'wave' : Fm.kind, off: P.off0 });
      if (ctx.face3) for (const q of pts) ctx.face3(q);     // (the cast's look3 on a non-v3 style: index.js) the strands that fell across the face
      const w = (L.width ?? [1.3, 0.5]).map(x => cm(x) * Fm.width * (inner ? 1.25 : outer ? 0.75 : 1) * (Fm.kind === 'curl' ? 0.6 : 1) * (L.width5K ?? 0.65)); w[0] *= 1 - 0.5 * edge;   // (HAIR4: narrower curl cards; HAIR5: every card narrower)
      // pressed under a hat: the card lies flat in the hat's shell, narrower (rolled or wide, its edges went through a fitted crown)
      if (g.pressed) { w[0] *= 0.7; w[1] *= 0.7; }
      const R0 = (L.roll ?? 1.2) * (g.pressed ? 0.15 : 1), tile = L.tile || (outer ? Fm.outer : inner ? Fm.inner : Fm.tile), roll = outer ? (rnd() - 0.5) * 2 * R0 : inner ? 0 : (rnd() - 0.5) * 0.5 * R0;
      const ua = rnd() * 0.25;
      B.ribbon(pts, { tile, ua, ub: ua + 0.6 + 0.15 * rnd(), w0: w[0], w1: w[1], roll, depth, rand: rnd(), grey: ctx.greyBias(sp.p), C: F.C, skin: p => skinBlend(F, sp, p) });
      made++;
    }
  });
  // clipper-short sides and nape (a taper under 0.6): short cards cover little, so the sides get their own dense pass of small flat
  // cards (without it a crop's sides were sparse squares over the scalp base)
  let fill = 0;
  if (L.taper && Math.min(L.taper.side ?? 1, L.taper.nape ?? 1) < 0.6 && L.sideFill !== false) {
    const topK = p => sstep(F.earTop - F.eyeY + 0.01, F.earTop - F.eyeY + 0.05, p.y - F.eyeY);
    const roots = sampleRoots(F, dens, Math.round(total * (L.sideFill ?? 0.8)), rnd, { mask: (p, ph, n) => (1 - topK(p)) * (mask ? mask(p, ph, n) : 1) });
    for (const sp of roots) {
      const len = lenAt(F, L, sp.p, rnd) * Fm.len; if (len < 0.002) continue;
      const g = growStrand(F, sp, len, { cling: 0.9, lift: 0.08 + 0.3 * Fm.lift, stiff: 1, comb: 1, grav: 0.1 * Fm.grav, jit: 0.15, off0: 0.0005, off1: 0.0015 * Fm.off, segLen: 0.004, maxSeg: 6, hatMargin: 0.0015 }, rnd, flow);
      if (g.hidden && !o.keepHidden) { hidden++; continue; }
      let pts = g.pts; if (Fm.A > 0 && L.curl !== false) pts = curlPts(F, pts, { A: Fm.A * 0.5, lam: Fm.lam, ph: rnd() * 6.283, kind: Fm.kind, off: 0.0005, ramp: 0.003 });
      const edge = dens?.dist ? sstep(0.008, 0.0, dens.dist(sp.p, sp.ph)) : 0;
      B.ribbon(pts, { tile: Fm.inner, ua: rnd() * 0.3, ub: 0.7 + 0.3 * rnd(), w0: cm(0.6) * Fm.width * (1 - 0.65 * edge) * 0.7, w1: cm(0.45) * Fm.width * (1 - 0.4 * edge) * 0.7, roll: (rnd() - 0.5) * 0.4, depth: 0.6, rand: rnd(), grey: ctx.greyBias(sp.p), C: F.C, skin: p => skinBlend(F, sp, p) });
      fill++;
    }
  }
  ctx.stats.push({ kind: L.kind, clumps: made, sideFill: fill, hiddenUnderHat: hidden });
}

// a rope hanging from a tie under gravity, resting on the back and shoulders
function rope(F, at, dir, len, r0, P = {}) {
  const T = F.fromHU(at), d0 = new THREE.Vector3(...dir).normalize();
  const flow = () => d0.clone();
  const hit = F.cast(T.x - F.C.x, T.y - F.C.y, T.z - F.C.z), sk = F.surf(hit.tri, hit.b1, hit.b2);   // the skin under the tie: its weights
  const sp = { ...sk, p: T, n: T.clone().sub(F.C).normalize(), ph: Math.atan2(T.x - F.C.x, T.z - F.C.z) };
  F.push(sp.p, r0 * 0.7);
  const g = growStrand(F, sp, len, { lift: 0, stiff: P.stiff ?? 0.9, comb: 0.25, grav: P.grav ?? 1.0, jit: 0, off0: r0, off1: P.r1 ?? r0 * 0.6, segLen: 0.012, maxSeg: 60, hat: false, rootOff: 0 }, () => 0.5, flow);
  return { pts: g.pts, sp };
}
// frames along a centreline: parallel transport, or (with up(p)) nx lying across the surface whose normal is up (cornrows, rolls)
function frames(pts, up = null) { const out = []; let prevN = null; for (let k = 0; k < pts.length; k++) { const d = (k < pts.length - 1 ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1])).normalize();
  let nx = up ? d.clone().cross(up(pts[k])) : prevN ? prevN.clone().addScaledVector(d, -prevN.dot(d)) : V(1, 0, 0).addScaledVector(d, -d.x); if (nx.lengthSq() < 1e-8) nx = V(0, 0, 1).addScaledVector(d, -d.z); nx.normalize(); prevN = nx; out.push({ d, nx, ny: d.clone().cross(nx) }); } return out; }

// under a hat a tie at `at` (head units) that would sit in the hat moves down the back of the head until its top (r above it) clears the
// rim: the hair is worn low at the nape under a hard hat; bare-headed nothing moves
function belowHat(F, at, r) {
  if (!F.hat) return at; let a = [...at];
  for (let k = 0; k < 30; k++) { const T = F.onScalp(a, 0), ph = Math.atan2(T.x - F.C.x, T.z - F.C.z); if (T.y + r < F.hat.rimAt(ph) - 0.006) break; a = [a[0], a[1] - 0.05, a[2] + (a[2] < 0 ? 0.012 : -0.012)]; }
  return a;
}
function tailLayer(ctx, L) {
  const { F, B, rnd, o } = ctx, Fm = FORMS[L.form || ctx.form] || FORMS.straight;
  if (F.hat) L = { ...L, at: belowHat(F, L.at, cm(L.r?.[0] ?? 1.5) * 1.2) };
  const r0 = cm(L.r?.[0] ?? 1.5), r1 = cm(L.r?.[1] ?? 0.7), len = cm(L.len ?? 22) * (L.plait ? 1 : Fm.len < 1 ? 0.5 + 0.5 * Fm.len : 1);
  const R = rope(F, L.at, L.dir || [0, -0.5, -1], len, r0 * (L.plait ? 0.9 : 1 + 0.4 * (Fm.off - 1)), { r1, grav: L.grav, stiff: L.stiff });
  const pts = R.pts, fr = frames(pts), Lr = arcLen(pts), sp = R.sp;
  // the tie: a band round the rope's start
  const tieAt = Math.min(2, pts.length - 1);
  B.tube([pts[0].clone().lerp(pts[tieAt], 0.3), pts[0].clone().lerp(pts[tieAt], 0.75)], { tile: 'dense', r: r0 * 0.62, sides: 10, depth: 0, rand: 0.5, grey: -10, skin: p => skinBlend(F, sp, p), vScale: 0.02 });
  if (L.plait) { plait(ctx, pts, fr, r0 * 0.85, r1, L, sp); ctx.stats.push({ kind: 'braid', len: +Lr.toFixed(3) }); return; }
  const n = Math.round((L.clumps ?? 150) * (o.density ?? 1)); let s = 0; const S = [0]; for (let k = 1; k < pts.length; k++) S.push(S[k - 1] + pts[k].distanceTo(pts[k - 1]));
  for (let c = 0; c < n; c++) {
    const a = rnd() * Math.PI * 2, rho = Math.sqrt(rnd()) * 0.9, endT = 0.55 + 0.45 * Math.sqrt(rnd()), twist = (rnd() - 0.5) * 0.8;
    const q = [];
    for (let k = 0; k < pts.length; k++) { const t = S[k] / Lr; if (t > endT) break; const rad = (r0 + (r1 - r0) * t) * rho * (1 + 0.35 * Math.sin(t * 9 + a)) , aa = a + twist * t * 6;
      q.push(F.push(pts[k].clone().addScaledVector(fr[k].nx, Math.cos(aa) * rad).addScaledVector(fr[k].ny, Math.sin(aa) * rad), 0.001)); }
    if (q.length < 2) continue;
    let qq = q; if (Fm.A > 0) qq = curlPts(F, q, { A: Fm.A * 0.9, lam: Fm.lam, ph: rnd() * 6.28, kind: Fm.kind, axis: p => nearestOn(pts, p), off: 0.001 });
    const outF = p => { const c0 = nearestOn(pts, p), d = p.clone().sub(c0); return d.lengthSq() > 1e-10 ? d.normalize() : V(0, 0, -1); };
    B.ribbon(qq, { tile: rho > 0.7 && rnd() < 0.5 ? Fm.outer : Fm.tile, ua: rnd() * 0.3, ub: 0.7 + 0.3 * rnd(), w0: cm(1.1) * Fm.width, w1: cm(0.45), roll: (rnd() - 0.5) * 2.4, depth: 1 - rho, rand: rnd(), grey: ctx.greyBias(sp.p), out: outF, skin: p => skinBlend(F, sp, p) });
  }
  ctx.stats.push({ kind: 'tail', clumps: n, len: +Lr.toFixed(3) });
}
function nearestOn(pts, p) { let best = pts[0], bd = 1e9; for (const q of pts) { const d = q.distanceToSquared(p); if (d < bd) { bd = d; best = q; } } return best; }

// a three-strand plait along a centreline: strand j at phase 2 pi j / 3 traces x = sin(th), y = sin(2 th) / 2 in the section (the
// over-under figure of a plait seen end on), each strand a tube with the hair running along it; a tie and a short loose end
function plait(ctx, pts, fr, rb, r1, L, sp) {
  const { F, B, rnd } = ctx, S = [0]; for (let k = 1; k < pts.length; k++) S.push(S[k - 1] + pts[k].distanceTo(pts[k - 1]));
  const Lr = S.at(-1), lam = cm(L.stitch ?? 3.2), flat = L.flat ?? 1, nS = Math.max(24, Math.round(Lr / lam * (L.perStitch ?? 14)));
  const C = resamplePts(pts, nS), FR = frames(C, L.up || null), Fm = FORMS[L.form || ctx.form] || FORMS.straight;
  for (let j = 0; j < 3; j++) {
    const q = [];
    for (let k = 0; k < nS; k++) { const t = k / (nS - 1), rbt = rb + (r1 - rb) * t, th = t * Lr / lam * Math.PI * 2 + j * Math.PI * 2 / 3;
      q.push(C[k].clone().addScaledVector(FR[k].nx, Math.sin(th) * rbt * 0.62).addScaledVector(FR[k].ny, Math.sin(2 * th) * 0.5 * rbt * 0.55 * flat)); }
    B.tube(q, { tile: 'plait', r: t => (rb + (r1 - rb) * t) * 0.5, sides: L.sides ?? 7, depth: 0.2, rand: rnd(), grey: ctx.greyBias(sp.p), vScale: 0.03, skin: p => skinBlend(F, sp, p), out: p => p.clone().sub(nearestOn(C, p)).normalize() });
  }
  // flyaways along the plait
  for (let c = 0; c < (L.fly ?? 26); c++) { const k = Math.floor(rnd() * (nS - 6)), q = [C[k].clone().addScaledVector(FR[k].nx, (rnd() - 0.5) * rb), C[k + 3].clone().addScaledVector(FR[k + 3].nx, (rnd() - 0.5) * rb * 1.6).addScaledVector(FR[k + 3].ny, rb * 0.9), C[k + 6].clone().addScaledVector(FR[k + 6].ny, rb * 1.1)];
    B.ribbon(q, { tile: 'fuzz', w0: cm(0.8), w1: cm(0.5), roll: rnd() * 3, depth: 0, rand: rnd(), grey: 0, out: p => p.clone().sub(nearestOn(C, p)).normalize(), skin: p => skinBlend(F, sp, p) }); }
  if (L.tie !== false) { const e = C.at(-1), d = FR.at(-1).d; B.tube([e.clone().addScaledVector(d, -0.006), e.clone()], { tile: 'dense', r: r1 * 0.55, sides: 8, depth: 0, rand: 0.3, grey: -10, skin: p => skinBlend(F, sp, p) });
    for (let c = 0; c < 10; c++) { const a = rnd() * 6.28, q = []; for (let s = 0; s <= 4; s++) q.push(e.clone().addScaledVector(d, 0.012 * s).addScaledVector(FR.at(-1).nx, Math.cos(a) * r1 * (0.3 + 0.25 * s)).addScaledVector(FR.at(-1).ny, Math.sin(a) * r1 * (0.3 + 0.25 * s)));
      B.ribbon(q, { tile: Fm.tile, w0: cm(0.7), w1: cm(0.3), roll: rnd() * 3, depth: 0.3, rand: rnd(), grey: 0, out: p => p.clone().sub(e).normalize(), skin: p => skinBlend(F, sp, p) }); } }
}

function bunLayer(ctx, L) {
  const { F, B, rnd, o } = ctx, Fm = FORMS[L.form || ctx.form] || FORMS.straight;
  if (F.hat) L = { ...L, at: belowHat(F, L.at, cm((L.size ?? [4.5, 3.6, 3.2])[1]) * 0.6 * (1 + 0.25 * (Fm.off - 1))) };
  const sz = (L.size ?? [4.5, 3.6, 3.2]).map(x => cm(x) * (1 + 0.25 * (Fm.off - 1))), T = F.onScalp(L.at, 0), nrm = T.clone().sub(F.C).normalize();
  const Cn = T.clone().addScaledVector(nrm, sz[2] * 0.75);
  const sp0 = (() => { const c = F.cast(T.x - F.C.x, T.y - F.C.y, T.z - F.C.z); return F.surf(c.tri, c.b1, c.b2); })();
  const n = Math.round((L.clumps ?? 90) * (o.density ?? 1));
  // the bun's frame: z along the head normal
  const ez = nrm, ex = V(0, 1, 0).cross(ez).normalize(), ey = ez.clone().cross(ex);
  const onE = (a, b, s) => Cn.clone().addScaledVector(ex, Math.cos(a) * Math.cos(b) * sz[0] * s).addScaledVector(ey, Math.sin(b) * sz[1] * s).addScaledVector(ez, Math.sin(a) * Math.cos(b) * sz[2] * s);
  for (let c = 0; c < n; c++) {
    const b = (rnd() - 0.5) * 2.2, a0 = rnd() * Math.PI * 2, span = 2.2 + 2.5 * rnd(), lay = 0.72 + 0.32 * Math.sqrt(rnd()), tilt = (rnd() - 0.5) * 0.9, q = [];
    for (let s = 0; s <= 14; s++) { const t = s / 14, a = a0 + span * t; q.push(F.push(onE(a, b + tilt * Math.sin(a), lay), 0.001)); }
    let qq = q; if (Fm.A > 0) qq = curlPts(F, q, { A: Fm.A * 0.7, lam: Fm.lam, ph: rnd() * 6.28, kind: Fm.kind, axis: () => Cn, off: 0.0008 });
    B.ribbon(qq, { tile: lay > 0.95 ? Fm.outer : Fm.tile, ua: rnd() * 0.3, ub: 0.75 + 0.25 * rnd(), w0: cm(1.4) * Fm.width, w1: cm(0.9), taper: 2, roll: (rnd() - 0.5) * 0.8, depth: 1.05 - lay, rand: rnd(), grey: ctx.greyBias(T), out: p => p.clone().sub(Cn).normalize(), skin: p => skinBlend(F, sp0, p) });
  }
  // a dense core so the bun never shows through
  B.tube([Cn.clone().addScaledVector(ey, -sz[1] * 0.45), Cn.clone().addScaledVector(ey, sz[1] * 0.45)], { tile: Fm.inner === 'coily' ? 'coily' : 'dense', r: t => Math.sin(Math.PI * (0.15 + 0.7 * t)) * Math.min(sz[0], sz[2]) * 0.72, sides: 10, around: true, depth: 0.9, rand: 0.4, grey: ctx.greyBias(T), skin: p => skinBlend(F, sp0, p), vScale: 0.03 });
  ctx.stats.push({ kind: 'bun', clumps: n });
}

// the hairline's fringe: short fine hairs (vellus and the first terminal hairs) in a band just inside the line, combed with the style's
// own flow and lying flat. Real hairlines are a gradient of fine hair, not an edge (added by groomHero to any style with scalp layers;
// "fringe": false in a style turns it off, { count, len, band } tunes it)
function fringeLayer(ctx, L, dens) {
  const { F, B, rnd, o, style } = ctx, src = (style?.layers || []).find(l => l.kind === 'scalp' || l.kind === 'guides') || {};
  if (!dens?.line) return;
  const band = cm(L.band ?? 0.8), flow = flowFn(F, { ...(src.flow || { type: 'back' }), to: src.flow?.to || src.gather?.to });
  const roots = sampleRoots(F, dens, Math.round((L.count ?? 180) * (o.density ?? 1)), rnd, { mask: (p, ph) => sstep(band, band * 0.3, dens.dist(p, ph)) });
  let made = 0, hidden = 0;
  for (const sp of roots) {
    const g = growStrand(F, sp, cm(rr(rnd, L.len ?? [0.4, 1.0])), { lift: 0.06, stiff: 0.8, comb: 0.9, grav: 0.1, jit: 0.25, off0: 0.0004, off1: 0.0012, segLen: 0.003, maxSeg: 5, cling: 0.85, hatMargin: 0.0015 }, rnd, flow);
    if (g.hidden && !o.keepHidden) { hidden++; continue; }
    B.ribbon(g.pts, { tile: 'vellus', ua: rnd() * 0.5, ub: 0.5 + 0.5 * rnd(), w0: cm(0.25), w1: cm(0.2), roll: (rnd() - 0.5) * 0.4, depth: 0, rand: rnd(), grey: ctx.greyBias(sp.p), C: F.C, bend: 0.8, skin: p => skinBlend(F, sp, p) });
    made++;
  }
  ctx.stats.push({ kind: 'fringe', clumps: made, hiddenUnderHat: hidden });
}

export const LAYER = { fringe: fringeLayer, scalp: scalpLayer, guides: scalpLayer, tail: tailLayer, braid: (c, L) => tailLayer(c, { ...L, plait: true }), bun: bunLayer };
export function registerLayer(kind, fn) { LAYER[kind] = fn; }
export { rope, frames, nearestOn, plait, cm, rr, belowHat };
