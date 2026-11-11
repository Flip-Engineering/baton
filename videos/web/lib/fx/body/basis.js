// BODY / BASIS (HUMAN c8 lane A): the body studio's own loader. One fetch of the shape basis (assets/body/basis.{json,bin}: the
// MakeHuman CC0 targets the generator mixes + our fields), the population tables (assets/body/population.json, scripts/body_calib.py)
// and the base hero bundle (assets/hero/hero.{json,bin}: the shared skin weights, regions, index buffers and expression morphs every
// person delegates to). hero.js's loadHeroData() keeps its first bundle in a module-level cache; this loader never touches it, so a
// lab that loads both gets two independent objects and CREW8 renders exactly as before.
//
//   const S = await loadBodyStudio();          // { basis, pop, hero: { meta, arr }, ... }  (about 11 MB over the wire)
//   S.target('macrodetails/universal-female-young-averagemuscle-averageweight')  -> { ix: Uint16Array, d: Float32Array (dm, xyz) }
//   S.field('glute') -> { ix, f: Float32Array, meta }      S.weight('headW') -> { ix, w }
// Formats (scripts/bake_body.py pack()): a target is k uint16 vertex ids then k*3 int16 deltas times a scale (MakeHuman decimetres);
// a field is k uint16 ids then k int16 values times a scale (peak 1); a weight is k uint16 ids then k uint16 / 65535.
const T = { float32: Float32Array, uint16: Uint16Array, uint32: Uint32Array, uint8: Uint8Array, float64: Float64Array, int16: Int16Array };
let _studio = null;
export async function loadBodyStudio({ base = new URL('../../../assets/', import.meta.url).href, force = false } = {}) {
  if (_studio && !force) return _studio;
  const get = (p, k) => fetch(base + p).then(r => r[k]());
  const [bm, bb, pop, hm, hb] = await Promise.all([get('body/basis.json', 'json'), get('body/basis.bin', 'arrayBuffer'), get('body/population.json', 'json'), get('hero/hero.json', 'json'), get('hero/hero.bin', 'arrayBuffer')]);
  return (_studio = makeStudio(bm, bb, pop, hm, hb));
}
export function makeStudio(bm, bb, pop, hm, hb) {
  const harr = k => { const a = hm.arrays[k]; if (!a) return null; const n = a.shape.reduce((x, y) => x * y, 1); return new T[a.dtype](hb, a.offset, n); };
  const cacheT = new Map(), cacheF = new Map(), cacheW = new Map();
  const S = {
    basis: bm, pop, hero: { meta: hm, arr: harr }, n: bm.n, nb: bm.nb,
    base: new Float32Array(bb, bm.base.o, bm.n * 3),
    target(name) {
      if (cacheT.has(name)) return cacheT.get(name);
      const t = bm.targets[name]; if (!t) { cacheT.set(name, null); return null; }
      const ix = new Uint16Array(bb, t.o, t.k), q = new Int16Array(bb, t.o + ((t.k * 2 + 3) & ~3), t.k * 3), d = new Float32Array(t.k * 3);
      for (let i = 0; i < d.length; i++) d[i] = q[i] * t.s;
      const r = { ix, d }; cacheT.set(name, r); return r;
    },
    field(name) {
      if (cacheF.has(name)) return cacheF.get(name);
      const t = bm.fields[name]; if (!t) return null;
      const ix = new Uint16Array(bb, t.o, t.k), q = new Int16Array(bb, t.o + ((t.k * 2 + 3) & ~3), t.k), f = new Float32Array(t.k);
      for (let i = 0; i < f.length; i++) f[i] = q[i] * t.s;
      const r = { ix, f, meta: t }; cacheF.set(name, r); return r;
    },
    weight(name) {
      if (cacheW.has(name)) return cacheW.get(name);
      const t = bm.weights[name]; if (!t) return null;
      const ix = new Uint16Array(bb, t.o, t.k), q = new Uint16Array(bb, t.o + ((t.k * 2 + 3) & ~3), t.k), w = new Float32Array(t.k);
      for (let i = 0; i < w.length; i++) w[i] = q[i] / 65535;
      const r = { ix, w }; cacheW.set(name, r); return r;
    },
    // dense helpers (cached): a field or weight over all n vertices
    dense(name) {
      const key = 'dense:' + name; if (cacheF.has(key)) return cacheF.get(key);
      const src = S.field(name) || S.weight(name); const out = new Float32Array(bm.n);
      if (src) { const v = src.f || src.w; for (let i = 0; i < src.ix.length; i++) out[src.ix[i]] = v[i]; }
      cacheF.set(key, out); return out;
    },
    fieldsOf(kind) { return Object.entries(bm.fields).filter(([, m]) => m.kind === kind).map(([k]) => k); },
  };
  // eye proxy refs
  const e = bm.eyes, ne = e.ne;
  S.eyes = { ne, idx: new Uint32Array(bb, e.o, ne * 3), w: new Float32Array(bb, e.o + ne * 12, ne * 3), off: new Float32Array(bb, e.o + ne * 24, ne * 3), scale: e.scale };
  // body triangles (hero.bin's idx_body) and per-vertex regions (hero.bin's region): shared topology
  S.tri = harr('idx_body'); S.region = harr('region');
  S.landmarks = bm.landmarks;
  return S;
}
