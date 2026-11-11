// CLOTH7 (round 6): the construction of a baked person rebuilt AS CLOTH (fold7.js): every turned hem, cuff facing and front facing
// that K3 (finish.js construct), K4 (wardrobe4/trim4.js) and the coats' trims built as a separate strip SWEPT from the edge (a straight
// profile 2-3.5 cm into the garment, through whatever the solved cloth did there: the shards at hems on shoes and boots, at tee hems,
// sleeve hems, cuffs, the coat's open fronts) is replaced by a layer of the garment's OWN mesh folded at that edge (fold7.plan7 /
// realize7). The part keeps its name, construction tag, fabric and colour (FABRIC6 shades it as before: a construction part, solid).
// Nothing else in the bake changes: the garments, the boots, the bands, pockets, collars, the skin cull are kept byte for byte.
//   rebuild7(parts, { M, scale, body, log })    parts: unpacked bake parts (finish.js unpackBake), edited in place; returns { report, plans }
//   rekey7(parts, plans, Pkey, { M, scale, body })  MOTION: the same layers realized on a KEY POSE's garment shapes (same topology)
import { weldGarment, posePart, plan7, realize7, outwardSign, TriGrid } from './fold7.js';
import { vertexNormals } from '../collide.js';
export const CONSTRUCT7_VERSION = 1;
// what is rebuilt, and how deep the turned layer is (m, flat): K3's / K4's own depths
export const FOLDS7 = [
  { re: /^hem$/, depth: 0.035 },                       // finish.js: the trousers' double-folded hem (3.5 cm)
  { re: /^tee\.hem$/, depth: 0.022 },                  // trim4: a tee's / scrub top's coverstitched body hem
  { re: /^tee\.hem\.sleeve$/, depth: 0.018 },          // trim4: the sleeve hems
  { re: /^skirt\.hem$/, depth: 0.035 },                // trim4: the skirt's turned hem
  { re: /^jacket\.hem\.(sleeve|back)$/, depth: 0.03 }, // trim4: the chore coat's sleeve and back hems
  { re: /^cuff\.edge\.[LR]$/, depth: 0.02 },           // finish.js: the shirt cuff's rolled edge -> the cuff's facing
  { re: /^placket\.open$/, depth: 0.016, run: true },  // finish.js: the open fronts above the top button (faced, 1.6 cm)
  { re: /^outer\.placket\.open$/, depth: 0.04, run: true },   // the chore coat's open fronts (its facing)
];
export const OPT7 = { off: 0.0011, minOff: 0.0003, bulge: 0.0009, near: 0.006, cover: 0.5 };

// runs of a loop whose vertices lie within `near` of the old strip's vertices (posed)
function runsNear(loop, Pw, Pq, near) {
  const cell = near, H = new Map(), key = (i, j, k) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048), nq = Pq.length / 3;
  for (let v = 0; v < nq; v++) { const k = key(Math.floor(Pq[v * 3] / cell), Math.floor(Pq[v * 3 + 1] / cell), Math.floor(Pq[v * 3 + 2] / cell)); (H.get(k) || H.set(k, []).get(k)).push(v); }
  const isNear = w => { const x = Pw[w * 3], y = Pw[w * 3 + 1], z = Pw[w * 3 + 2], ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const u of H.get(key(ci + a, cj + b, ck + c)) || []) if ((Pq[u * 3] - x) ** 2 + (Pq[u * 3 + 1] - y) ** 2 + (Pq[u * 3 + 2] - z) ** 2 < near * near) return true; return false; };
  const ids = loop.ids, inS = ids.map(isNear), k = inS.filter(Boolean).length; if (inS.every(Boolean)) return { frac: 1, runs: [{ ids: ids.slice(), closed: loop.closed }] };
  const out = []; let s = inS.findIndex(x => !x), cur = []; for (let q = 1; q <= ids.length; q++) { const i = (s + q) % ids.length; if (inS[i]) cur.push(ids[i]); else if (cur.length) { out.push(cur); cur = []; } } if (cur.length) out.push(cur);
  return { frac: k / ids.length, runs: out.filter(r => r.length > 3).map(r => ({ ids: r, closed: false })) };
}

// parts: the bake's parts (X bind metres, T, SI, SW, uv, panel, name, group, owner, construction, fabric, color); body: { X, T } posed (m)
export function rebuild7(parts, { M, scale, body = null, log = () => {}, folds = FOLDS7, opt = {} } = {}) {
  const o = { ...OPT7, ...opt }, t0 = Date.now(), rep = { version: CONSTRUCT7_VERSION, folds: [], replaced: [], kept: [] }, plans = [];
  const gar = parts.filter(q => q.group === 'garment'), posed = new Map(); for (const q of parts) if (q.group === 'garment' || q.group === 'boot' || folds.some(f => f.re.test(q.name))) posed.set(q, posePart(q, M, scale));
  // everything a layer may meet: the garments (their own other folds too), the body, the shoes
  const grid = new TriGrid(0.008); for (const g of gar) grid.add(posed.get(g), g.T, 'g:' + g.owner); if (body) grid.add(body.X, body.T, 'body'); for (const q of parts) if (q.group === 'boot') grid.add(posed.get(q), q.T, 'boot');
  // the ruler's set: every garment (posed), one triangle list
  let nX = 0, nT = 0; for (const g of gar) { nX += g.X.length; nT += g.T.length; } const check = { X: new Float64Array(nX), T: new Int32Array(nT) }; { let ox = 0, ot = 0; for (const g of gar) { check.X.set(posed.get(g), ox); for (let i = 0; i < g.T.length; i++) check.T[ot + i] = g.T[i] + ox / 3; ox += g.X.length; ot += g.T.length; } }
  const W = new Map(), sgn = new Map(), drop = [];
  for (let pi = 0; pi < parts.length; pi++) { const q = parts[pi], f = folds.find(f2 => f2.re.test(q.name)); if (!f || q.group !== 'construction') continue;
    const owner = q.owner || q.part, g = gar.find(x => x.owner === owner || x.name === owner); if (!g) { rep.kept.push({ name: q.name, why: 'no garment ' + owner }); continue; }
    if (!W.has(g)) { const Wg = weldGarment(g), Pp = posed.get(g), Pw = new Float64Array(Wg.m * 3); for (let w = 0; w < Wg.m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = Pp[Wg.rep[w] * 3 + c]; W.set(g, { Wg, Pw }); sgn.set(g, outwardSign(Pw, vertexNormals(Pw, Wg.T), body)); }
    const { Wg, Pw } = W.get(g), Pq = posed.get(q);
    // the free edge(s) the old strip was built on
    const cand = Wg.loops.map(L => ({ L, ...runsNear(L, Pw, Pq, o.near) })).filter(c => c.frac > 0).sort((a, b) => b.frac - a.frac);
    let runs = []; if (f.run) { for (const c of cand) runs.push(...c.runs.map(r => ({ ...r }))); runs = runs.sort((a, b) => b.ids.length - a.ids.length).slice(0, 2); }
    else { const c = cand[0]; if (c && c.frac >= o.cover) runs = [{ ids: c.L.ids, closed: c.L.closed }];
      // the edge cut into pieces (an inner garment's cloth under an outer one is not drawn: the tee's hem under a chore coat): every piece
      else for (const c2 of cand) runs.push(...c2.runs.filter(r => r.ids.length > 3)); }
    // no drawn edge of its garment anywhere near the strip (a tucked tee's hem inside the trousers: that cloth is not drawn): the strip
    // finishes cloth no one sees, and crosses what is drawn: left out
    if (!cand.length) { drop.push(pi); rep.kept.push({ name: q.name, why: 'no drawn edge: left out' }); continue; }
    if (!runs.length) { rep.kept.push({ name: q.name, why: 'no edge near', cand: cand.slice(0, 2).map(c => +c.frac.toFixed(2)) }); continue; }
    const pieces = [];
    for (const r of runs) { const pl = plan7(g, Wg, r.ids, { depth: f.depth, closed: r.closed, name: q.name }); if (!pl) continue;
      const z = realize7(g, Wg, pl, posed.get(g), { M, scale, grid, check, off: o.off, minOff: o.minOff, bulge: o.bulge, sign: sgn.get(g) }); pieces.push({ pl, z }); }
    if (!pieces.length) { rep.kept.push({ name: q.name, why: 'empty plan' }); continue; }
    // one part (the pieces merged), in place of the strip: same name, tag, fabric, colour
    let nv = 0, nt = 0; for (const { z } of pieces) { nv += z.X.length / 3; nt += z.T.length; }
    const X = new Float64Array(nv * 3), T = new Int32Array(nt), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4); let ov = 0, ot = 0;
    for (const { z } of pieces) { X.set(z.X, ov * 3); SI.set(z.SI, ov * 4); SW.set(z.SW, ov * 4); for (let i = 0; i < z.T.length; i++) T[ot + i] = z.T[i] + ov; ov += z.X.length / 3; ot += z.T.length; }
    const np = { name: q.name, group: 'construction', owner: q.owner, part: q.part, construction: q.construction, fabric: q.fabric, color: q.color, sewn: q.sewn, X, T, SI, SW, uv: new Float64Array(nv * 2), flatUv: false, solid: false };
    parts[pi] = np; plans.push({ index: pi, name: q.name, owner, garment: parts.indexOf(g), pieces: pieces.map(x => x.pl), sign: sgn.get(g), depth: f.depth });
    const r0 = { name: q.name, owner, depth: f.depth, runs: runs.map(r => r.ids.length), oldTris: q.T.length / 3, ...pieces.reduce((a, { z }) => { for (const [k, v] of Object.entries(z.report)) a[k] = (a[k] || 0) + (typeof v === 'number' ? v : 0); return a; }, {}) };
    r0.meanOffMm = +(pieces.reduce((a, { z }) => a + z.report.meanOffMm, 0) / pieces.length).toFixed(2); rep.folds.push(r0); log('fold7', JSON.stringify(r0)); }
  // (the parts left out go last, so the plans' indices stay right)
  for (const pi of drop.sort((a, b) => b - a)) { parts.splice(pi, 1); for (const P of plans) { if (P.index > pi) P.index--; if (P.garment > pi) P.garment--; } }
  rep.ms = Date.now() - t0; return { report: rep, plans, grid };
}

// MOTION: the planned layers realized on a key pose. parts: the stance bake's parts (bind X of the KEY: stance + the key's garment offsets),
// M: the key pose's bone matrices. Returns per plan the key's bind X (same vertex order as the stance's rebuilt part).
export function rekey7(parts, plans, { M, scale, body = null, opt = {} } = {}) {
  const o = { ...OPT7, ...opt }, gar = parts.filter(q => q.group === 'garment'), posed = new Map(); for (const q of parts) if (q.group === 'garment' || q.group === 'boot') posed.set(q, posePart(q, M, scale));
  const grid = new TriGrid(0.008); for (const g of gar) grid.add(posed.get(g), g.T, 'g'); if (body) grid.add(body.X, body.T, 'body'); for (const q of parts) if (q.group === 'boot') grid.add(posed.get(q), q.T, 'boot');
  let nX = 0, nT = 0; for (const g of gar) { nX += g.X.length; nT += g.T.length; } const check = { X: new Float64Array(nX), T: new Int32Array(nT) }; { let ox = 0, ot = 0; for (const g of gar) { check.X.set(posed.get(g), ox); for (let i = 0; i < g.T.length; i++) check.T[ot + i] = g.T[i] + ox / 3; ox += g.X.length; ot += g.T.length; } }
  const out = [], Wc = new Map();
  for (const P of plans) { const g = parts[P.garment]; if (!Wc.has(g)) Wc.set(g, weldGarment(g)); const Wg = Wc.get(g); const xs = [], reps = [];
    for (const pl of P.pieces) { const z = realize7(g, Wg, pl, posed.get(g), { M, scale, grid, check, off: o.off, minOff: o.minOff, bulge: o.bulge, sign: P.sign }); xs.push(z.X); reps.push(z.report); }
    let n = 0; for (const x of xs) n += x.length; const X = new Float64Array(n); let ov = 0; for (const x of xs) { X.set(x, ov); ov += x.length; } out.push({ index: P.index, name: P.name, X, report: reps }); }
  return out;
}
