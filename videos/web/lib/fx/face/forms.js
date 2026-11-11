// FACE / FORMS (HUMAN c8 P2): the small forms that make a CG face read as a photograph's: the nasolabial fold, the philtral columns and
// groove, the vermilion's white roll, the upper lid's crease and the lid margins' thickness, the alar crease, the tear trough, the
// mentolabial sulcus, the marionette line and the jowl.
//
// Each form is a CURVE anchored on the person's own landmarks (offsets in a face frame, in mm scaled by the person's face length) and a
// PROFILE across it (a crease, a ridge, a fold that overhangs on one side), with an amplitude that follows age, BMI and sex. The field is
// RESOLUTION-INDEPENDENT: displacement(point, normal, spacing) is a function of a surface point, so it applies to the hm08 base mesh and,
// sharper, to P1's subdivision (lib/fx/body/subdiv.js) evaluated at its own vertices. To keep the base mesh honest the profile is
// BAND-LIMITED to the local vertex spacing h: sigma_eff = sqrt(sigma^2 + (0.6 h)^2) and the amplitude scales by sigma / sigma_eff, so the
// form's cross-section integral (its 'volume' per unit length) is kept and only its sharpness waits for the finer mesh.
// Amplitudes and curve placements are OURS, by eye against the period photographs on the board and the surgical-anatomy descriptions
// (the supratarsal crease ~8-10 mm above the lash line in European women, 6-8 in men, ~4-6 or absent in East Asian lids: Sim et al. 2000;
// the nasolabial fold deepening and the malar fat descending with age, the marionette and jowl from middle age: e.g. Mendelson and Wong
// 2012, Rohrich and Pessa 2007 on the fat compartments) -- descriptive, not measured: the board is the check.
//   formsField(F, P, N, H, nb, ctx) -> { D: Float32Array nb (metres along the normal), report }
//   evalForms(forms, points, normals, spacing) -> Float32Array: the same field on any point set (P1's subdivided mesh)
import { rng, clamp, gauss } from './sample.js';
const v3 = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => { const l = Math.hypot(...a) || 1; return mul(a, 1 / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// the face frame: x the person's left (ex_R -> ex_L), y up (gn -> n, made orthogonal), z forward; mm scaled by the face length / 120
export function faceFrame(F, P) {
  const I = F.ids, L = n => v3(P, I[n]);
  const x = nrm(sub(L('ex_L'), L('ex_R'))), yr = sub(L('n'), L('gn')), y = nrm(sub(yr, mul(x, dot(yr, x)))), z = cross(x, y);
  const o = mul(add(L('en_L'), L('en_R')), 0.5), u = Math.hypot(...sub(L('n'), L('me'))) / 0.120 * 0.001;   // metres per 'face mm'
  return { x, y, z, o, u, at: (p, dx = 0, dy = 0, dz = 0) => add(add(add(p, mul(x, dx * u)), mul(y, dy * u)), mul(z, dz * u)), L };
}
const catmull = (pts, k = 8) => { if (pts.length < 3) return pts; const out = [];
  for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < k; s++) { const t = s / k, t2 = t * t, t3 = t2 * t; out.push([0, 1, 2].map(a => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3))); } }
  out.push(pts[pts.length - 1]); return out; };
// the forms of one person: curves (in metres, bind space) + profiles. ctx: { sex, age, bmi, ctx (sample.js feature context), scale, seed }
export function buildForms(F, P, ctx) {
  const fr = faceFrame(F, P), L = fr.L, at = fr.at, r = rng(((ctx.seed ?? 1) * 2654435761 + 99) >>> 0), jit = (s = 0.25) => Math.max(0.3, 1 + gauss(r) * s);
  const ageK = clamp((ctx.age - 25) / 50), bmiK = clamp((ctx.bmi - 24) / 12, -0.5, 1), male = ctx.sex === 'm' ? 1 : 0, asian = ctx.ctx?.asian || 0, S = ctx.scale ?? 1;
  const forms = [];
  // profile kinds: crease (A<0 at t=0), ridge (A>0), fold: crease + a bump of B at t0 on 'side' (a direction in the frame's x/y)
  const form = (name, pts, o) => forms.push({ name, pts: catmull(pts, 8), ...o, A: (o.A || 0) * S, B: (o.B || 0) * S });
  for (const [s, sg] of [['L', 1], ['R', -1]]) {
    const al = L('al_' + s), ch = L('ch_' + s);
    // nasolabial fold: from the alar-facial groove to beside and below the mouth corner; longer and deeper with age, the cheek's fat
    // overhanging laterally (the fold), more with BMI
    const len = 0.65 + 0.35 * ageK, j = jit();
    form('nasolabial_' + s, [at(al, sg * 3, 4), at(al, sg * 5, -3), at(ch, sg * 9, 4), at(ch, sg * 10, -4), at(ch, sg * (10 + 3 * len), -6 - 12 * len)],
      { A: -(0.3 + 1.4 * ageK + 0.25 * Math.max(bmiK, 0)) * j, sig: 1.4, B: (0.3 + 2.0 * ageK + 0.8 * Math.max(bmiK, 0)) * j, sigB: 4.2, t0: 3.6, side: [sg, 0.35], fade: [0.08, 0.35], zr: 14 });
    // philtral column: from the columella's side to the cupid's bow peak; flatter with age
    form('philtrum_' + s, [at(L('sn'), sg * 3.2, -1.2, -1), at(L('ls'), sg * 4.6, 5), at(L('ls'), sg * 5.4, 2.4)], { A: (0.7 - 0.35 * ageK) * jit(0.2), sig: 1.0, fade: [0.15, 0.1], zr: 6 });
    // vermilion white roll: the upper lip's border from the corner to the bow peak
    form('vermilion_' + s, [at(ch, -sg * 1.5, 0.8), at(L('ls'), sg * 12, 2.4), at(L('ls'), sg * 5.4, 2.6), at(L('ls'), 0, 1.6)], { A: 0.16 * (1 - 0.5 * ageK), sig: 0.55, fade: [0.2, 0.05], zr: 5 });
    // alar crease: round the alar lobule from its base up over its top toward the dorsum
    form('alar_' + s, [at(al, -sg * 1.5, -3.5, -1), at(al, sg * 0.3, -0.5), at(al, -sg * 0.5, 3.5), at(al, -sg * 3.5, 5.8), at(al, -sg * 7.5, 6.2)], { A: -0.8 * jit(0.2), sig: 0.85, fade: [0.12, 0.3], zr: 8 });
    // tear trough (nasojugal groove) and its lateral continuation (palpebromalar): from middle age, less in a full face
    const en = L('en_' + s), pi = L('pi_' + s);
    form('tearTrough_' + s, [at(en, sg * 1, -5), at(en, sg * 4, -10), at(pi, sg * 2, -11), at(pi, sg * 10, -10)], { A: -Math.max(0, 0.1 + 1.2 * ageK - 0.3 * Math.max(bmiK, 0)) * jit(), sig: 2.4, fade: [0.15, 0.4], zr: 10 });
    // marionette line and the jowl beside it, from middle age; the jowl with BMI
    const am = Math.max(0, ageK - 0.3) / 0.7;
    form('marionette_' + s, [at(ch, sg * 1.5, -2), at(ch, sg * 4, -11), at(ch, sg * 7, -20)], { A: -(1.8 * am) * jit(), sig: 1.8, B: (2.0 * am + 0.4 * Math.max(bmiK, 0) * (0.3 + am)) * jit(), sigB: 5.5, t0: 6, side: [sg, -0.2], fade: [0.1, 0.4], zr: 14 });
    // the upper lid: the supratarsal crease parallel to the margin (its height by sex and group; low or absent in many East Asian lids),
    // the skin above it hooding with age; and the lid margins' own roll (the ~2 mm thick margin: a ridge just outside it)
    const loop = (F.lid[s] || []).map(v => v3(P, v)), c = mul(loop.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / Math.max(1, loop.length));
    const up = loop.filter(p => dot(sub(p, c), fr.y) > 0.0005).sort((a, b) => sg * (dot(a, fr.x) - dot(b, fr.x))), lo = loop.filter(p => dot(sub(p, c), fr.y) <= 0.0005).sort((a, b) => sg * (dot(a, fr.x) - dot(b, fr.x)));
    if (up.length > 2) {
      const hasCrease = asian > 0.5 ? r() > 0.45 : true, ch_ = (male ? 6.5 : 8) * (1 - 0.45 * asian) * jit(0.12) + 1.5 * Math.max(0, ageK - 0.4);
      const crease = up.map(p => { const d = sub(p, c), w = Math.max(0, dot(nrm(d), fr.y)); return add(p, mul(fr.y, ch_ * fr.u * (0.35 + 0.65 * w))); });
      if (hasCrease) form('lidCrease_' + s, crease, { A: -0.8 * jit(0.2), sig: 0.8, B: 0.15 + 1.0 * Math.max(0, ageK - 0.35), sigB: 2.2, t0: 2.2, side: [0, 1], fade: [0.15, 0.15], zr: 9 });
      form('lidMarginU_' + s, up.map(p => add(p, mul(fr.y, 1.1 * fr.u))), { A: 0.45, sig: 0.65, fade: [0.12, 0.12], zr: 5 });
    }
    if (lo.length > 2) form('lidMarginL_' + s, lo.map(p => sub(p, mul(fr.y, 1.0 * fr.u))), { A: 0.32, sig: 0.6, fade: [0.15, 0.15], zr: 5 });
  }
  // the philtral groove (the dimple between the columns) and the mentolabial sulcus
  form('philtralGroove', [at(L('sn'), 0, -1.5, -1), at(L('ls'), 0, 4)], { A: -(0.45 - 0.15 * ageK) * jit(0.2), sig: 1.5, fade: [0.2, 0.25], zr: 6 });
  form('mentolabial', [at(L('mm_R'), 4, 2), at(L('sl'), -9, 0.5), at(L('sl'), 0, 0), at(L('sl'), 9, 0.5), at(L('mm_L'), -4, 2)], { A: -(0.35 + 0.2 * male + 0.15 * ageK) * jit(0.2), sig: 3.2, fade: [0.25, 0.25], zr: 10 });
  return { frame: fr, forms };
}
// distance from p to a polyline, measured in the frame's x/y plane (the forms are seen from the front), with the arc parameter, the
// closest point and its frame-z (to keep a form off surfaces behind it: the inner lips, the far side of the nose)
function closest(fr, pts, p) {
  let best = { d: Infinity }, acc = 0, tot = 0; const seg = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(...sub(pts[i + 1], pts[i])); seg.push(l); tot += l; }
  const px = dot(p, fr.x), py = dot(p, fr.y);
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], ax = dot(a, fr.x), ay = dot(a, fr.y), bx = dot(b, fr.x), by = dot(b, fr.y);
    const ux = bx - ax, uy = by - ay, l2 = ux * ux + uy * uy || 1e-12, t = clamp(((px - ax) * ux + (py - ay) * uy) / l2), qx = ax + t * ux, qy = ay + t * uy, d = Math.hypot(px - qx, py - qy);
    if (d < best.d) best = { d, s: (acc + t * seg[i]) / (tot || 1), qx, qy, z: dot(a, fr.z) * (1 - t) + dot(b, fr.z) * t };
    acc += seg[i]; }
  best.dx = px - best.qx; best.dy = py - best.qy; return best;
}
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// the field at one surface point (metres along its normal); h: the local vertex spacing (m)
export function formAt(fr, f, p, h) {
  const u = fr.u, reach = Math.max(f.sig * 4, (f.sigB || 0) * 3 + (f.t0 || 0) + 2) * u;
  const c = closest(fr, f.pts, p); if (c.d > reach) return 0;
  // depth: a smooth fade, not a cut (a cut where the profile is not yet zero draws a line in the shading)
  const dz = Math.abs(dot(p, fr.z) - c.z) / (f.zr * u), zf = 1 - sstep(0.55, 1, dz); if (!zf) return 0;
  const fade = zf * sstep(0, f.fade[0], c.s) * sstep(0, f.fade[1], 1 - c.s); if (!fade) return 0;
  const hu = h / u, sg = Math.hypot(f.sig, 0.6 * hu), t = c.d / u;
  let out = f.A * (f.sig / sg) * Math.exp(-t * t / (2 * sg * sg));
  if (f.B) { const sd = Math.hypot(...(f.side || [1, 0])), sgn = Math.sign((c.dx * (f.side[0] / sd) + c.dy * (f.side[1] / sd)) || 1), ts = sgn * t - f.t0, sb = Math.hypot(f.sigB, 0.6 * hu);
    out += f.B * (f.sigB / sb) * Math.exp(-ts * ts / (2 * sb * sb)); }
  return out * fade * u;                                              // face-mm -> metres
}
export function evalForms(built, P, N, H, n, region = null, facing = null) {
  const { frame: fr, forms } = built, D = new Float32Array(n);
  // a box per form to skip far vertices quickly
  const boxes = forms.map(f => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of f.pts) { const x = dot(p, fr.x), y = dot(p, fr.y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const m = Math.max(f.sig * 4, (f.sigB || 0) * 3 + (f.t0 || 0) + 2) * fr.u; return [x0 - m, x1 + m, y0 - m, y1 + m]; });
  for (let v = 0; v < n; v++) { if (region && region[v] > 1 && region[v] !== 11) continue;      // head, neck, jaw (the forms' own reach keeps them on the face)
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], nz = N[v * 3] * fr.z[0] + N[v * 3 + 1] * fr.z[1] + N[v * 3 + 2] * fr.z[2];
    const fc = facing ? facing[v] : sstep(0.05, 0.35, nz); if (!fc) continue;
    const x = dot(p, fr.x), y = dot(p, fr.y); let s = 0;
    for (let i = 0; i < forms.length; i++) { const b = boxes[i]; if (x < b[0] || x > b[1] || y < b[2] || y > b[3]) continue; s += formAt(fr, forms[i], p, H[v]); }
    D[v] = s; }
  return D;
}
export function formsField(F, P, N, H, nb, ctx) {
  const built = buildForms(F, P, ctx), D = evalForms(built, P, N, H, nb, ctx.region, ctx.facing);
  const report = Object.fromEntries(built.forms.map(f => [f.name, { A: +f.A.toFixed(2), B: f.B ? +f.B.toFixed(2) : 0, sig: f.sig, pts: f.pts.length }]));
  let mn = 0, mx = 0; for (let v = 0; v < nb; v++) { mn = Math.min(mn, D[v]); mx = Math.max(mx, D[v]); }
  report._range_mm = [+(mn * 1000).toFixed(2), +(mx * 1000).toFixed(2)];
  return { D, report, built };
}

// P1's subdivision (lib/fx/body/detail.js): registerDetail('face', faceDetail). At level L the base mesh already carries each form
// band-limited to its own spacing (baked into the person's positions), so what the finer mesh adds is the DIFFERENCE between the
// form at the fine spacing and at the coarse one (2^L x): a zero-mean sharpening, never the form twice. Reads the face record that
// withFace() put on the person (ctx.p.face); a person without one is left alone.
export function faceDetail(ctx) {
  const face = ctx.p?.face, built = face?.formsBuilt, lv = ctx.o?.level || 0; if (!built || !lv) return;
  const n = ctx.n, k = 2 ** lv, H = ctx.hv, Hc = new Float32Array(n), region = new Uint8Array(n), facing = new Float32Array(n), z = built.frame.z;
  for (let v = 0; v < n; v++) { Hc[v] = H[v] * k; region[v] = Math.round(ctx.region(v)); const c = ctx.N[v * 3] * z[0] + ctx.N[v * 3 + 1] * z[1] + ctx.N[v * 3 + 2] * z[2]; facing[v] = sstep(0.05, 0.35, c); }
  const Df = evalForms(built, ctx.P, ctx.N, H, n, region, facing), Dc = evalForms(built, ctx.P, ctx.N, Hc, n, region, facing);
  for (let v = 0; v < n; v++) { const d = Df[v] - Dc[v]; if (d) ctx.add(v, d); }
}
