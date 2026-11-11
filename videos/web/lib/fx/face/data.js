// FACE / DATA (HUMAN c8 P2): the face studio's own loader. One fetch of assets/face/ (sources/face/bake_face.py):
//   face_basis.{json,bin}  MakeHuman CC0 face targets (head, nose, mouth, chin, cheek, forehead, eyebrows, eyes, ears) in decimetres on
//                          hm08, and the eye proxy's references (each eye vertex rides on 3 mesh vertices)
//   landmarks.json         Farkas craniofacial landmarks and the soft-tissue depth sites as hm08 vertex ids (shared topology: lane A's
//                          persons and the CREW8 heroes alike), the lid-margin loops, how each was picked
//   face_pop.json          ANSUR II head and face measures by sex x group (+ age / stature / BMI slopes, residual correlations),
//                          Farkas-style soft-tissue measures by sex x group (cited per value), age rules, soft-tissue depths
// About 1 MB once. Nothing here touches hero.js's or lane A's caches.
let _face = null;
export async function loadFaceStudio({ base = new URL('../../../assets/face/', import.meta.url).href, force = false } = {}) {
  if (_face && !force) return _face;
  const get = (p, k) => fetch(base + p).then(r => r[k]());
  const [bm, bb, lm, pop] = await Promise.all([get('face_basis.json', 'json'), get('face_basis.bin', 'arrayBuffer'), get('landmarks.json', 'json'), get('face_pop.json', 'json')]);
  return (_face = makeFaceStudio(bm, bb, lm, pop));
}
export function makeFaceStudio(bm, bb, lm, pop) {
  const cache = new Map();
  const F = {
    basis: bm, pop, lm, ids: lm.ids, lid: lm.lidMargin,
    has: name => !!bm.targets[name],
    target(name) {                                   // -> { ix: Uint16Array, d: Float32Array (dm, xyz) } | null
      if (cache.has(name)) return cache.get(name);
      const t = bm.targets[name]; if (!t) { cache.set(name, null); return null; }
      const ix = new Uint16Array(bb, t.o, t.k), q = new Int16Array(bb, t.o + ((t.k * 2 + 3) & ~3), t.k * 3), d = new Float32Array(t.k * 3);
      for (let i = 0; i < d.length; i++) d[i] = q[i] * t.s;
      const r = { ix, d }; cache.set(name, r); return r;
    },
  };
  const e = bm.eyeRef; F.eyeRef = { ne: e.ne, idx: new Uint16Array(bb, e.o, e.ne * 3), w: new Float32Array(bb, e.wo, e.ne * 3) };
  return F;
}
