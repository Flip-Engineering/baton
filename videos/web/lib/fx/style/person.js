// STYLE / person: where a styled person comes from (lane E). A person is a hero data object ({ meta, arr }); this file only
// gathers what shape.js reads off one: the landmarks and the bony relief lane A measured on the shared topology, and the
// CREW8 record with castHero's bone scales baked in.
//
//   import { loadBasisAnchors, crewPerson } from '../lib/fx/style/person.js';
//   const AN = await loadBasisAnchors();                         // lane A's basis.json landmarks + its bone-relief fields
//   const base = crewPerson(data, spec, ansur, AN);              // CREW8 worker -> the record every style starts from
//   const P = styleShape(base, { level: 2 });                    // anchors: lane A's landmarks, ridges held by its relief
//
// Lane A's basis (assets/body/basis.{json,bin}, scripts/bake_body.py, CC0) shares the hero bundle's vertex indexing (n 19158),
// so its 66 landmarks (vertex ids) and relief fields apply to every CREW8 body as they are. Without it shape.js measures its own
// proxies (the CREW8 path, unchanged). A person from lane A's castBody already carries S.landmarks; pass them the same way.
import { personFrom } from './shape.js';
import { castHero } from '../workforce.js';
import { build } from '../body/mix.js';

let _an = null;
// field format (bake_body.py pack()): k uint16 vertex ids, padded to 4 bytes, then k int16 values times the field's scale
function decodeField(bb, t) { const ix = new Uint16Array(bb, t.o, t.k), q = new Int16Array(bb, t.o + ((t.k * 2 + 3) & ~3), t.k), f = new Float32Array(t.k); for (let i = 0; i < t.k; i++) f[i] = q[i] * t.s; return { ix, f }; }
export async function loadBasisAnchors({ base = new URL('../../../assets/body/', import.meta.url).href, relief = true } = {}) {
  if (_an) return _an;
  const bm = await fetch(base + 'basis.json').then(r => r.json());
  const out = { landmarkIds: { ...bm.landmarks }, notes: bm.landmarkNotes, relief: null, source: 'assets/body/basis.json (HUMAN c8 lane A, CC0)' };
  if (relief) { const bb = await fetch(base + 'basis.bin').then(r => r.arrayBuffer()); out.relief = {};
    for (const [nm, t] of Object.entries(bm.fields)) if (t.kind === 'relief') out.relief[nm] = { ...decodeField(bb, t), mode: t.mode || 'bone', note: t.note }; }
  return (_an = out);
}
// a CREW8 worker as a baked person (castHero's ANSUR bone lengths in the bind), anchored on lane A's landmarks when given
export function crewPerson(data, spec, ansur, anchors = null, castOpts = { c7: true }) {
  const { opts, apply } = castHero(spec, ansur, castOpts);
  const src = anchors ? { data, variant: spec.variant, landmarkIds: anchors.landmarkIds, relief: anchors.relief } : { data, variant: spec.variant };
  const P = personFrom(src, spec.variant, { apply, height: opts.height, label: spec.name });
  P.sex = spec.sex; return { P, opts, apply };
}

// A person from lane A's castBody (or loadCast), with its LAYERS: each soft layer as a bind displacement, by rebuilding the
// person with that layer switched off (lane A's own build(): relief off, muscle off, fat off) and differencing. shape.js then
// simplifies per layer instead of band-passing the surface: L0.5 drops the relief, L1 low-passes the summed muscle (the
// groups' boundaries go, the masses stay) and envelopes the fat (never thinner than its own low-pass: creases filled); the
// breast is kept as a mass. Three extra builds (~0.1-0.3 s each in node).
export function bodyLayers(p) {
  const S = p._S, prm = p.params, full = p.built.pos, n3 = full.length, out = [];
  for (const [kind, off] of [['relief', { relief: 0 }], ['muscle', { muscle: {} }], ['fat', { fat: {} }]]) {
    const B = build(S, { ...prm, ...off }), D = new Float32Array(n3); let mx = 0;
    for (let i = 0; i < n3; i++) { D[i] = full[i] - B.pos[i]; mx = Math.max(mx, Math.abs(D[i])); }
    out.push({ kind, D, max: +mx.toFixed(4) }); }
  return out;
}
// the record every style starts from, for a lane A person: its own landmarks (S.landmarks), relief fields and layers
export function bodyPerson(p, { layers = true } = {}) {
  const S = p._S, relief = {};
  for (const [nm, t] of Object.entries(S.basis.fields)) if (t.kind === 'relief') { const f = S.field(nm); relief[nm] = { ix: f.ix, f: f.f, mode: t.mode || 'bone', note: t.note }; }
  const src = { data: p, variant: p.name, landmarkIds: S.landmarks || S.basis.landmarks, relief, layers: layers ? bodyLayers(p) : null, kin: p.kin };
  const P = personFrom(src, p.name, { height: p.height, label: p.label || p.name }); P.sex = p.sex; P.kin0 = p.kin; return P;
}
