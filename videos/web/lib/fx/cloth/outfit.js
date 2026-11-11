// OUTFIT (CLOTHING c2, K1): one person's clothes as an ordered stack, from the nude body up. Pure data (JSON-serialisable) and the
// compiler that turns it into a solve order, the collider each garment drapes on, the bake key of each garment's stack prefix, and the
// people.js descriptor (the same person dressed the same at crowd distance). No three.js; stack.js does the solving.
//
//   outfit = { person: 'crew:rosa' | 'lanea:<name>', era: 2026, mode: 'shell' | 'made-to-measure' | 'sized',
//     layers: [ { id, design, fabric?, color?, color2?, layer?, zones?, rules? }, ... ] }   innermost first (the order is a hint: the
//     compiler orders by layer rank and the rules, and the list order breaks ties)
//   design   'hero.top' | 'hero.bottom' | 'hero.vest' | 'hero.skirt'   the hero's own CLOTHING c1 shell garment (keeps its cuts, rims, collar)
//            'shell.tee' | 'shell.shirt' | 'shell.tank'                  an extra garment made on the hero's body (h._shell), e.g. an undershirt
//            'belt'                                                       a belt over the trousers' waistband: a hold and a part of its own
//            'hero.boots' | 'hero.gloves'                                 rigid accessories: in the collider, not draped
//            'pattern:<name>'                                             a sewn garment from K2's pattern pipeline (sew.js), given as
//                                                                         layer.pattern (the contract in review/.../after/stack/NOTES.md)
//   layer    support | under | base | main | mid | outer | over | acc | feet | hands | head  (rank, innermost first; default from the design)
//   zones    body zones the garment covers (default from the design); two garments interact only where their zones meet
//   rules    tuck: 'in' | 'out'           a top in or over the bottoms at the waist (in: the tail goes under the waistband ring)
//            over: [ids], under: [ids]    explicit order against named garments (the hi-vis vest over a coat: over: ['coat'])
//            sleeves: { roll: n }         n turns (c1 shells: the sleeve end set by the hero's cut)
//            closed: bool                 a coat or vest closed (true) or open (c1 shells are closed; K2 closures carry the state)
//            cuffs: 'in' | 'out'          sleeve or trouser hem inside or over a glove or boot (default out: over the boot)
//            cinch: m                     a belt's take-up of the waistband girth (default 0.02)
// The solve order is a topological sort of "is under" relations, one per body zone (a tucked shirt is under the trousers at the waist
// and outermost at the chest); a cycle (two garments that really interleave) is reported and broken by the list order.
export const OUTFIT_VERSION = 1;
export const ZONES = ['head', 'neck', 'chest', 'back', 'waist', 'hips', 'seat', 'uarms', 'farms', 'hands', 'thighs', 'shins', 'feet'];
export const RANK = { support: 0, under: 1, base: 2, main: 3, mid: 4, outer: 5, over: 6, acc: 7, feet: 1, hands: 8, head: 8 };
const TOP_Z = ['neck', 'chest', 'back', 'waist', 'uarms', 'farms'], BOT_Z = ['waist', 'hips', 'seat', 'thighs', 'shins'];
// the catalogue of what the stack can wear now (K2's patterns and K3's foundations add 'pattern:' designs)
export const DESIGNS = {
  'hero.top':    { source: 'hero', key: 'top', part: 'top', layer: 'main', zones: [...TOP_Z, 'hips'], crowd: { part: 'top' } },
  'hero.bottom': { source: 'hero', key: 'bottom', part: 'bottom', layer: 'main', zones: BOT_Z, crowd: { part: 'bottom' } },
  'hero.vest':   { source: 'hero', key: 'vest', part: 'vest', layer: 'over', zones: ['chest', 'back', 'waist'], crowd: { part: 'vest' } },
  'hero.skirt':  { source: 'hero', key: 'skirt', part: 'skirt', layer: 'outer', zones: ['hips', 'seat', 'thighs'], crowd: { part: 'skirt' } },
  'hero.boots':  { source: 'rigid', key: 'boots', layer: 'feet', zones: ['feet', 'shins'] },
  'hero.gloves': { source: 'rigid', key: 'gloves', layer: 'hands', zones: ['hands', 'farms'] },
  'shell.tee':   { source: 'shell', part: 'top', kind: 'tee', sleeve: -0.62, layer: 'base', zones: [...TOP_Z.filter(z => z !== 'farms')], fabric: 'jersey', crowd: { part: 'top' } },
  'shell.tank':  { source: 'shell', part: 'top', kind: 'tee', sleeve: -1, layer: 'base', zones: ['chest', 'back', 'waist'], fabric: 'jersey', crowd: { part: 'top' } },
  'shell.shirt': { source: 'shell', part: 'top', kind: 'work', sleeve: 1.0, layer: 'main', zones: TOP_Z, fabric: 'chambray', crowd: { part: 'top' } },
  'belt':        { source: 'belt', layer: 'main', zones: ['waist'], fabric: 'leather' },
  // K3 foundations (foundations.js wearFoundations puts them on the hero first; the stack drapes everything over the body as they dress it)
  'found.bra':        { source: 'found', layer: 'support', zones: ['chest', 'back'] },
  'found.briefs':     { source: 'found', layer: 'support', zones: ['waist', 'hips', 'seat'] },
  'found.boxers':     { source: 'found', layer: 'support', zones: ['waist', 'hips', 'seat', 'thighs'] },
  'found.undershirt': { source: 'found', layer: 'under', zones: ['neck', 'chest', 'back', 'waist', 'uarms'] },   // with the trousers (after them in the list): over the waistband, under a vest or coat
};
export const designOf = (L) => (L.design?.startsWith('pattern:') ? { source: 'pattern', layer: L.pattern?.layer ?? 'main', zones: L.pattern?.zones || (L.pattern?.crowd?.part === 'bottom' ? BOT_Z : TOP_Z), crowd: L.pattern?.crowd || null, ...(L.partOf ? { part: L.partOf } : {}) } : DESIGNS[L.design]);   // partOf (K3, opt-in): 'top' | 'bottom' for a sewn garment
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

// outfit -> { order: [ids] (solve order, innermost first), layers: Map(id -> layer + resolved design, rank, zones), under: Map(id -> [ids
//            it drapes over: solved earlier, sharing a zone]), over: Map(id -> [ids over it]), cycles: [[ids]], rigid: [ids], notes: [] }
export function compileOutfit(outfit) {
  const L = new Map(), notes = [];
  outfit.layers.forEach((x, i) => { const d = designOf(x); if (!d) { notes.push(`unknown design ${x.design} (${x.id}): left out`); return; }
    L.set(x.id, { ...x, d, rank: RANK[x.layer || d.layer] ?? 3, zones: x.zones || d.zones || [], idx: i, rules: x.rules || {} }); });
  const ids = [...L.keys()], shares = (a, b) => a.zones.some(z => b.zones.includes(z));
  // per zone, a < b ("a is under b") by: explicit rules, then the tuck rule at the waist, then rank, then list order
  const below = (a, b, z) => { const A = L.get(a), B = L.get(b);
    if ((A.rules.over || []).includes(b) || (B.rules.under || []).includes(a)) return false;
    if ((A.rules.under || []).includes(b) || (B.rules.over || []).includes(a)) return true;
    const top = x => x.d.part === 'top' || x.d.crowd?.part === 'top', bot = x => x.d.part === 'bottom' || x.d.crowd?.part === 'bottom';
    if (['waist', 'hips', 'seat'].includes(z) && Math.abs(A.rank - B.rank) <= 1) {
      if (top(A) && bot(B)) return (A.rules.tuck ?? 'in') === 'in'; if (bot(A) && top(B)) return (B.rules.tuck ?? 'in') !== 'in'; }
    if (A.rank !== B.rank) return A.rank < B.rank; return A.idx < B.idx; };
  const edges = new Map(ids.map(i => [i, new Set()]));
  for (const a of ids) for (const b of ids) { if (a === b) continue; const A = L.get(a), B = L.get(b); for (const z of A.zones) if (B.zones.includes(z) && below(a, b, z)) edges.get(a).add(b); }
  // topological sort (Kahn), ties by rank then list order; a cycle is broken at its lowest-ranked garment
  const indeg = new Map(ids.map(i => [i, 0])); for (const [, s] of edges) for (const b of s) indeg.set(b, indeg.get(b) + 1);
  const order = [], cycles = [], key = i => [L.get(i).rank, L.get(i).idx]; let ready = ids.filter(i => indeg.get(i) === 0);
  const rem = new Set(ids);
  while (rem.size) { if (!ready.length) { const cyc = [...rem].sort((p, q) => key(p)[0] - key(q)[0] || key(p)[1] - key(q)[1]); cycles.push(cyc); notes.push(`interleaved (solved by list order, jointly settled): ${cyc.join(', ')}`); ready = [cyc[0]]; }
    ready.sort((p, q) => key(p)[0] - key(q)[0] || key(p)[1] - key(q)[1]); const x = ready.shift(); if (!rem.has(x)) continue; rem.delete(x); order.push(x);
    for (const b of edges.get(x)) { indeg.set(b, indeg.get(b) - 1); if (indeg.get(b) === 0 && rem.has(b)) ready.push(b); } }
  const under = new Map(), over = new Map();
  for (const x of order) { under.set(x, order.slice(0, order.indexOf(x)).filter(y => shares(L.get(x), L.get(y)))); over.set(x, order.slice(order.indexOf(x) + 1).filter(y => shares(L.get(x), L.get(y)))); }
  return { order, layers: L, under, over, cycles, rigid: order.filter(i => L.get(i).d.source === 'rigid'), notes };
}
// a garment's own signature (what it is and how it is worn, not who wears it)
export const garmentSig = x => JSON.stringify([x.design, x.fabric || x.d?.fabric || null, x.rules || {}, x.zones || null, x.pattern ? fnv(JSON.stringify(x.pattern, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v))) : null]);
// bake keys: each garment's key hashes the person and pose key (`base`), its own signature, and the keys of everything UNDER it that it
// shares a zone with (its stack prefix): taking the jacket off re-solves nothing under it; putting a coat on solves the coat.
export function stackKeys(C, base, versions = '') {
  const keys = new Map();
  for (const x of C.order) { const L = C.layers.get(x), parts = [versions, base, garmentSig(L), ...C.under.get(x).map(y => keys.get(y))]; keys.set(x, `${x}-${fnv(parts.join('|'))}${fnv(parts.slice().reverse().join('|'))}`); }
  return keys;
}
// undress / redress: what must be re-solved when garment `id` changes (or goes): itself and everything over it in a shared zone
export function dirtyAfter(C, id) { const out = new Set([id]); for (const x of C.order) if (C.under.get(x).some(y => out.has(y))) out.add(x); return C.order.filter(x => out.has(x)); }
export const without = (outfit, id) => ({ ...outfit, layers: outfit.layers.filter(l => l.id !== id) });
export const withLayer = (outfit, layer, at = null) => { const L = outfit.layers.filter(l => l.id !== layer.id); L.splice(at ?? L.length, 0, layer); return { ...outfit, layers: L }; };

// ---------------------------------------------------------------- the crowd: the same outfit as a people.js descriptor
// people.js reads top, bottom, vest, coverall, accent today; the rest (silhouette, length, layers, fabric) is the contract for its next
// owner (skirts, robes, long coats, head coverings): what is SEEN from outside at crowd distance, from the outermost garment per region.
export function crowdOf(outfit, colorOf = () => null) {
  const C = compileOutfit(outfit), seen = { top: null, bottom: null, vest: null, skirt: null, coat: null }, fabric = {};
  for (const x of C.order) { const L = C.layers.get(x), part = L.d.crowd?.part; if (!part) continue; const col = L.color || colorOf(L) || null;
    if (part === 'top') { if (L.rank >= RANK.outer) seen.coat = { id: x, color: col }; else if (!seen.coat) seen.top = { id: x, color: col }; fabric.top = L.fabric || L.d.fabric || null; }
    else if (part === 'bottom') { seen.bottom = { id: x, color: col }; fabric.bottom = L.fabric || L.d.fabric || null; }
    else if (part === 'vest') { seen.vest = { id: x, color: col }; fabric.vest = L.fabric || null; }
    else if (part === 'skirt') seen.skirt = { id: x, color: col }; }
  const top = seen.coat || seen.top;
  return { top: top?.color ?? null, bottom: seen.bottom?.color ?? null, vest: seen.vest?.color ?? undefined, coat: !!seen.coat, accent: top?.color ?? null,
    silhouette: { top: seen.coat ? 'coat' : seen.top ? 'shirt' : 'bare', length: seen.coat || seen.skirt ? 'thigh' : 'hip', bottom: 'trousers' },
    layers: C.order.filter(x => C.layers.get(x).d.source !== 'rigid'), fabric, outfit: OUTFIT_VERSION };
}
