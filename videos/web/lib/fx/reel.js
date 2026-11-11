// REEL (7 Oct 2026): the studio's footage-plate player. Plates are baked by scripts/reelbake.py (or the older per-piece bakes, same layout:
// assets/<piece>/plates/<shot>/0001.jpg ... + index.json). A piece gives a cut list; the reel draws the right frame of the right shot, pushed in
// over the cut, into any 2D context. FOOTNOTE and FLINT each carried a copy of this; new pieces use this.
//
//   import { Reel } from '../lib/fx/reel.js';
//   const reel = await Reel.load('../assets/ore/plates');
//   const reel = await Reel.load(['../assets/workday/plates', '../assets/vanquished/plates'])   // several libraries, one namespace of shots
//   const CUTS = Reel.cuts([[beat, 'shot', { off, z: [1.04, 1.12], rate, hold, cy }], ...], b => b * 0.5, endT);
//   await reel.draw(g, t, CUTS);            // -> { cut, age, u } (u: 0..1 through the cut), or null before the first cut
//   await reel.drawShot(g, 'shot', f, { z, cy })   // one frame of one shot
import { W, H, clamp, lerp } from '../kit.js';

export class Reel {
  constructor(base, idx) { this.base = base; this.idx = idx; this.cache = new Map(); this.max = 64; }
  static async load(base) {
    const bases = Array.isArray(base) ? base : [base], idx = {};
    for (const b of bases) { const j = await (await fetch(`${b}/index.json`)).json(); for (const k in j) idx[k] = { ...j[k], base: b }; }
    return new Reel(bases[0], idx);
  }
  n(shot) { return this.idx[shot]?.n || 1; }
  async frame(shot, i) {
    i = Math.max(0, Math.min(this.n(shot) - 1, i | 0));
    const k = shot + '/' + i, c = this.cache;
    if (c.has(k)) { const v = c.get(k); c.delete(k); c.set(k, v); return v; }
    const bm = await createImageBitmap(await (await fetch(`${this.idx[shot]?.base || this.base}/${shot}/${String(i + 1).padStart(4, '0')}.jpg`)).blob());
    c.set(k, bm); if (c.size > this.max) { const o = c.keys().next().value; c.get(o).close(); c.delete(o); }
    return bm;
  }
  // a cut list: [start (in the piece's units), shot, { off: s into the shot, z: [from, to], rate, hold: frame | -1, cy: 0..1 }], mapped to seconds
  static cuts(list, toT = x => x, endT = Infinity) {
    const out = list.map(([s, shot, o = {}]) => ({ t: toT(s), shot, off: o.off || 0, z: o.z || [1.03, 1.1], rate: o.rate ?? 1, hold: o.hold ?? -1, cy: o.cy ?? 0.5, o }));
    out.forEach((c, i) => { c.end = i + 1 < out.length ? out[i + 1].t : endT; });
    return out;
  }
  static at(cuts, t) { let c = null; for (const x of cuts) if (t >= x.t) c = x; return c; }
  async drawShot(g, shot, f, { z = 1, cy = 0.5, x = 0, y = 0, w = W, h = H } = {}) {
    const bm = await this.frame(shot, f), dw = w * z, dh = h * z;
    g.drawImage(bm, x + (w - dw) / 2, y + (h - dh) * cy, dw, dh); return bm;
  }
  async draw(g, t, cuts, opt = {}) {
    const c = Reel.at(cuts, t); if (!c) return null;
    const age = t - c.t, u = clamp(age / Math.max(1e-3, c.end - c.t));
    const f = c.hold >= 0 ? c.hold : Math.floor((c.off + age * c.rate) * (this.idx[c.shot]?.fps || 24));
    const ez = opt.ease || (x => x);
    await this.drawShot(g, c.shot, f, { z: lerp(c.z[0], c.z[1], ez(u)), cy: c.cy, ...(opt.rect || {}) });
    return { cut: c, age, u };
  }
}
