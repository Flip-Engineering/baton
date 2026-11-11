// TIMELINE: sections that own their simulations' clocks, lifetimes, budgets and saved state.
//
//   const tl = new Timeline({ spb: B.spb, name: 'lab_physics', key: await sourceKey([import.meta.url, '../lib/fx/physics.js']) });
//   const A = tl.section('fluid', { from: 0, to: 8, preroll: 1.2, draw: (t, u, s) => { ... } });   // beats; u = the section's sim clock
//   const fluid = A.own('fluidA', Fluid.preset('smoke', { ... }));                                  // this sim runs on A's clock
//   world.release(D.ev(28), ids);                            // D.ev(beat) = the sim-clock time of a global beat (schedule events with it)
//   E.use(worldD);                                           // a later section that reads worldD keeps it alive
//   await tl.load();                                         // optional: resume every sim from out/.<name>.sim.bin (key must match)
//   window.renderFrame = t => tl.render(t);                  // picks the section, frees sims whose last section is past,
//                                                            // checks the per-frame budget (steady sequential frames only)
//   window.SIM = tl.api();                                   // hash(t) / bake() / save() / budget() for web/simtest.mjs
//
// Clocks: u = t - start + preroll, so a sim is already moving on the section's first visible frame.
// Lifetime: once t passes the end of the last section that owns or uses a sim, the sim's snapshots
// and checkpoints (GPU textures for fluids) are freed. A still that jumps back re-imports the saved
// state (if a sim.bin was loaded) or replays.
// Stepping: render() advances every sim the section owns to its clock before calling draw.
// Budget: a frame rendered right after its predecessor (a clip, not a seek) that takes longer than
// `budget` ms logs BUDGET FAIL on the console and lands in budget().fails; render.mjs exits 3 on it.
import { packBin, unpackBin, hashStr } from './physics.js';

export async function sourceKey(urls) {
  let h = 0x811c9dc5;
  for (const u of urls) { try { h = hashStr(await (await fetch(u, { cache: 'no-store' })).text(), h); } catch { h = hashStr('missing:' + u, h); } }
  return (h >>> 0).toString(16);
}

class Section {
  constructor(tl, name, { from, to, preroll = 0, draw, setup = null, budget = null }) {
    Object.assign(this, { tl, name, from, to, preroll, drawFn: draw, setup, budgetMs: budget ?? tl.budget });
    this.owned = []; this.used = [];
  }
  get start() { return this.tl.bt(this.from); }
  get end() { return this.tl.bt(this.to); }
  clock(t) { return t - this.start + this.preroll; }
  ev(beat) { return this.tl.bt(beat) - this.start + this.preroll; }      // sim-clock time of a global beat
  age(t) { return t - this.start; }
  own(label, sim) { this.tl.sims.set(label, { sim, owner: this }); sim.label = label; this.owned.push(sim); return sim; }
  use(...sims) { this.used.push(...sims); return this; }
}

export class Timeline {
  constructor({ spb, fps = 30, budget = 1500, name = null, key = '' }) {
    Object.assign(this, { spb, fps, budget, name, key });
    this.sections = []; this.sims = new Map(); this.loaded = null; this.stale = new Set();
    this.stats = {}; this.fails = []; this.prevF = null; this.prevSec = null; this.after = null;
  }
  bt(b) { return b * this.spb; }
  section(name, o) { const s = new Section(this, name, o); this.sections.push(s); return s; }
  at(t) { let s = this.sections[0]; for (const x of this.sections) if (t >= x.start - 1e-9) s = x; return s; }
  // the last time any section needs this sim
  _lastUse(sim) { let e = -Infinity; for (const s of this.sections) if (s.owned.includes(sim) || s.used.includes(sim)) e = Math.max(e, s.end); return e; }
  _gc(t) {
    for (const [label, { sim }] of this.sims) {
      if (this.stale.has(label) || t < this._lastUse(sim)) continue;
      sim.free(); this.stale.add(label);
    }
  }
  _ensure(sec) {
    // setup: once, before any sim of the section steps (render, hash or bake), e.g. a fuel mask an emitter reads
    if (sec.setup && !sec.didSetup) { sec.didSetup = true; sec.setup(); }
    for (const sim of [...sec.owned, ...sec.used]) {
      const label = sim.label; if (!this.stale.has(label)) continue;
      this.stale.delete(label);
      if (this.loaded && this.loaded[label]) sim.importState(this.loaded[label]);
    }
  }
  async render(t) {
    const f = Math.round(t * this.fps), sec = this.at(t);
    const steady = this.prevF === f - 1 && this.prevSec === sec;
    this._ensure(sec);
    const t0 = performance.now();
    // step every owned sim to this frame before anything is drawn: a GPU fluid stepping while the 2D
    // frame has queued draws stalls SwiftShader badly (measured 17-20 s/frame vs 1.6 s in the fire section)
    const u = sec.clock(t);
    for (const sim of sec.owned) { if (sim.seek) sim.seek(sim.frameIndex(u)); else sim.at(u); }
    await sec.drawFn(t, u, sec);
    if (this.after) await this.after(t, f);
    const ms = performance.now() - t0;
    const st = this.stats[sec.name] || (this.stats[sec.name] = { n: 0, sum: 0, max: 0, sn: 0, ssum: 0, smax: 0 });
    st.n++; st.sum += ms; st.max = Math.max(st.max, ms);
    if (steady) {
      st.sn++; st.ssum += ms; st.smax = Math.max(st.smax, ms);
      if (ms > sec.budgetMs) { this.fails.push({ section: sec.name, t, ms }); console.error(`BUDGET FAIL section=${sec.name} t=${t.toFixed(3)} ${ms.toFixed(0)} ms > ${sec.budgetMs} ms`); }
    }
    this.prevF = f; this.prevSec = sec;
    this._gc(t);
    return ms;
  }
  // ---- per-section report
  budgetReport() {
    const rows = this.sections.map(s => { const x = this.stats[s.name]; if (!x) return null;
      return { section: s.name, frames: x.n, meanMs: Math.round(x.sum / x.n), maxMs: Math.round(x.max), steadyFrames: x.sn, steadyMeanMs: x.sn ? Math.round(x.ssum / x.sn) : null, steadyMaxMs: x.sn ? Math.round(x.smax) : null, budgetMs: s.budgetMs }; }).filter(Boolean);
    return { rows, fails: this.fails.length, worst: this.fails.slice().sort((a, b) => b.ms - a.ms).slice(0, 5) };
  }
  // ---- state hashing (determinism test): every sim owned by the section at t, on its owner's clock
  hash(t) {
    const sec = this.at(t), out = {};
    this._ensure(sec);
    for (const sim of sec.owned) out[sim.label] = sim.hashAt(sec.clock(t)).toString(16).padStart(8, '0');
    return out;
  }
  // ---- serialization: out/.<name>.sim.bin (CPU checkpoints + impacts; fluid checkpoints as fp32/fp16)
  bake(labels = null) {
    for (const [label, { sim, owner }] of this.sims) {
      if (labels && !labels.includes(label)) continue;
      this._ensure(owner);
      const u = owner.clock(this._lastUse(sim) - 1e-6);
      if (sim.seek) sim.seek(sim.frameIndex(u)); else sim.at(u);
    }
  }
  exportAll() { const sims = {}; for (const [label, { sim }] of this.sims) if (!this.stale.has(label)) sims[label] = sim.exportState(); return packBin({ key: this.key, sims }); }
  async save() {
    const buf = this.exportAll();
    const r = await fetch(`../../out/.${this.name}.sim.bin`, { method: 'PUT', body: buf });
    if (!r.ok) throw new Error('sim save failed ' + r.status);
    return buf.byteLength;
  }
  async load() {
    try {
      const r = await fetch(`../../out/.${this.name}.sim.bin`, { cache: 'no-store' });
      if (!r.ok) return false;
      const o = unpackBin(await r.arrayBuffer());
      if (o.key !== this.key) { console.warn(`sim.bin key ${o.key} != ${this.key}: stale, ignored`); return false; }
      this.loaded = o.sims; this.didLoad = true;
      for (const [label, st] of Object.entries(o.sims)) { const e = this.sims.get(label); if (e) e.sim.importState(st); }
      return true;
    } catch (e) { console.warn('sim.bin load failed: ' + e.message); return false; }
  }
  api() {
    return { hash: t => this.hash(t), bake: l => this.bake(l), save: () => this.save(), load: () => this.load(), budget: () => this.budgetReport(),
      sims: () => [...this.sims.keys()], loaded: () => !!this.didLoad, sections: () => this.sections.map(s => ({ name: s.name, from: s.start, to: s.end })) };
  }
}
