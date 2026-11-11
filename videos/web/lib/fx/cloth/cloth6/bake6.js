// CLOTH6 (round 6): K4's wardrobe baked with CLOTH5's fixes (cloth5/bake5.js: outfits, boots, collar fall, cuff join) and CLOTH6's solver
// into assets/person/v6c/ (makePerson('v4:<name>', { bake: 'v6c' }) with wardrobe4/fabrics4.js registerFabrics4() on the page).
// What it changes over v5c (every piece an opt-in of the file it is in; nothing here touches a default path):
//   SELF-COLLISION  self6.js on every garment's cloth in the sew (welded ids: a seam's two sides never collide), the A-pose settle and the
//                   carry (locked sides, continuous check, friction), and in the joint settle (with the layer order: an inner garment held
//                   under an outer one); K1's selfTri / CLOTH5's self5 off where self6 runs
//   CARRY           the skin's jump of each step in `sub` pieces, each checked continuously against the side it started on
//   UNTANGLING      untangle6.js (contours, islands, the shallower end back through) after each sew ramp stage, the weld, the settle, every
//                   carry step and the joint settle; what still crosses is marked tangled (no side defended)
//   STRAIN          edges past (1 + strain) shortened every substep after the self projection
import { bakeCloth5 } from '../cloth5/bake5.js';
import { Self6 } from './self6.js';
import { untangleCloth6, smoothPlaced } from './untangle6.js';
import { hemSide6 } from './fix6.js';
export const CLOTH6_VERSION = 1, V6C_DIR = 'v6c';
// the cloth's half-thickness for self contact: half the fabric's thickness plus `pad` of air, at least `minTh` (two layers then sit
// 2 x th apart: 2.2-3.4 mm on the wardrobe's fabrics, against 13.5 mm triangles)
export const SELF6 = { tangleEvery: 24, pad: 0.0008, minTh: 0.0011, every: 8, maxPush: 0.004, mu: 0.3, strain: 0.10, margin: 0.006, last: true, lastPush: 0.004, vote: true, untangleMove: 0.006 };
export const STACK6 = { sew: { T: 1.2, hz: 900, iters: 4, self: false }, carry: { sub: 4, subIters: 4, subPush: 0.004 } };
// only: the garments (stack ids) self6 solves; the chore coat ('outer') is left out: measured on L23 and L12 its elbows crossed MORE with
// self-collision (L23's coat 2019 -> 3051 drawn, elbow 2088), as CLOTH5 found with self5; the joint settle keeps its layer order
export const ONLY6 = ['trousers', 'top', 'shirt'];
export async function bakeCloth6(S, e, outfit, { log = () => {}, only = ONLY6, untangle = true, sewSelf = true, joint6 = true, self6 = {}, stack = {}, probe = null, stats = null, hems = false, ...rest } = {}) {
  const t0 = Date.now(), cfg = { ...SELF6, ...self6 }, ust = stats?.untangle || {}, made = stats?.made || [];
  const thOf = F => Math.max(cfg.minTh, (F?.h ?? 0.0006) / 2 + cfg.pad), on = id => !only || only.includes(id);
  const attach = (cl, o) => { cl.c6 = new Self6(cl, { th: thOf(o.F), every: cfg.every, maxPush: cfg.maxPush, mu: cfg.mu, strain: cfg.strain, margin: cfg.margin, last: cfg.last, lastPush: cfg.lastPush, ring: cfg.ring, tangleEvery: cfg.tangleEvery, tangleMove: cfg.tangleMove, stride: cfg.stride, ...(o.wid ? { wid: o.wid } : {}), ...(o.sew ? cfg.sew || {} : {}) }); made.push(cl.c6); return cl.c6; };
  const uo = { vote: !!cfg.vote, maxMove: cfg.untangleMove ?? 0.012 };
  const un = untangle ? (cl, stage, id) => { if (!cl.c6) return; untangleCloth6(cl, { stats: ust, key: stage.replace(/[0-9]+$/, '') + ':' + id, ...uo, ...(cl._wid6 ? { wid: cl._wid6 } : {}) }); } : null;
  const st6 = {
    self5: undefined, jointSelf: joint6 ? false : undefined, jointMetric6: cfg.jointMetric !== false, ...(only ? { sew6only: only } : {}),
    self6: (cl, o) => { if (on(o.id)) attach(cl, o); },
    ...(cfg.placed ? { placed6: (X0, S0, pat, ctx, L) => { if (!on(L.id)) return; const r = smoothPlaced(X0, S0.tris, S0.n, { wid: S0.root, body: ctx.bodyPosed, ...(typeof cfg.placed === 'object' ? cfg.placed : {}) }); const s = ust['placed:' + L.id] ||= { before: 0, after: 0, moved: 0 }; s.before += r.before; s.after += r.after; s.moved += r.moved; } } : {}),
    sew: { ...STACK6.sew, ...(stack.sew || {}), ...(sewSelf ? { c6: (cl, Sx) => { cl._wid6 = Sx.root; attach(cl, { F: Sx.fabs[0], wid: Sx.root, sew: true }); }, ...(un ? { untangle: cl => un(cl, 'sew', 'garment') } : {}) } : { self: true }) },
    carry: { ...STACK6.carry, ...(stack.carry || {}) },
    ...(un ? { untangle: un } : {}),
    ...(joint6 ? { self6joint: (cl, x) => { const c6 = new Self6(cl, { th: x.th.map((t, i) => Math.max(cfg.minTh, t + cfg.pad * 0.5)), layer: x.lay, order: true, vis: x.vis, same: true, ring: cfg.ring, tangleEvery: cfg.tangleEvery, tangleMove: cfg.tangleMove, stride: cfg.stride, every: cfg.every, maxPush: cfg.maxPush, mu: cfg.mu, strain: cfg.strain, margin: cfg.margin, last: cfg.last, lastPush: cfg.lastPush });
      const U = new Float64Array(cl.n * 3); for (let i = 0; i < cl.n; i++) { const q = x.ctx.bodyPosed.closest(cl.X[i * 3], cl.X[i * 3 + 1], cl.X[i * 3 + 2], 0.15); if (q) { U[i * 3] = q.nx; U[i * 3 + 1] = q.ny; U[i * 3 + 2] = q.nz; } }
      if (only) { const fs = new Uint8Array(cl.n); x.draped.forEach((r, li) => { if (!only.includes(r.id)) fs.fill(1, x.offs[li], x.offs[li] + r.cl.n); }); c6.freeSame = fs; }
      c6.up = U; cl.c6 = c6; made.push(c6); if (un) untangleCloth6(cl, { stats: ust, key: 'jointIn', ...uo }); } } : {}),
    ...Object.fromEntries(Object.entries(stack).filter(([k]) => !['sew', 'carry'].includes(k))) };
  // hems (opt-in): construction strips (hems, cuff edges, plackets) kept on one side of their garment's cloth (fix6.js), after the construction
  const fixH = hems ? { fix: { ...(rest.fix || {}), post: async (h, Sx, parts, G, c) => hemSide6(h, Sx, parts, { scale: c.scale, FIN: c.FIN, log: c.log, ...(typeof hems === 'object' ? hems : {}) }) } } : {};
  const r = await bakeCloth5(S, e, outfit, { log, untangle: false, stack: st6, probe, ...rest, ...fixH });
  const c6s = made.reduce((a, c) => { for (const k of Object.keys(c.stats)) a[k] = (a[k] || 0) + c.stats[k]; return a; }, {}); c6s.ms = Math.round(c6s.ms || 0);
  r.report.cloth6 = { version: CLOTH6_VERSION, self6: cfg, only, hems: !!hems, untangle: ust, c6: c6s, ms: Date.now() - t0, ...(r.report.finish?.fix5 ? { hemSide6: r.report.finish.fix5 } : {}) };
  return r;
}
