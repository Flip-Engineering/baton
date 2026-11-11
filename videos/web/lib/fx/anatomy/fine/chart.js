// ANATOMY / FINE / CHART (DETAIL7, round 7, 8 Oct 2026): the head's dedicated UV island (the 'fine' chart) carried onto a person's body.
// Ours, CC0.
//
// The chart is computed ONCE on hm08's topology (review/studio_human_c8/after/detail7/tools/head_chart.py: the head and jaw regions forward
// of the ears' back edge and below the hairline zone, minus the eye sockets' and the mouth's linings; LSCM then an importance-weighted ARAP:
// eyes, nose, lips and ears get about twice the periphery's linear density) and stored per base vertex (assets/person/fine7/head_chart.*).
// Every person shares hm08's vertex ids (lane A's form-1 body, the learned priors, the CREW8 heroes), so one chart serves everyone.
// On a subdivided body (lib/fx/body/subdiv.js keeps the original ids and appends edge vertices level by level) the chart's uv is carried
// LINEARLY: an edge vertex takes the mean of its edge's two ends (the 3/8 entries of the Loop stencil row), and it is ON the chart only when
// that edge belongs to a chart triangle of the level above. Positions follow Loop's smoothing, the uv the flat midpoints: still a valid map
// (no fold), and every child of a chart triangle is a chart triangle.
//
//   const C = await loadChart(baseUrl)                 // { uv0 (Float32 2 x nb, NaN off), tris0 (base triangle ids), aspect, size4k, meta }
//   const K = chartOnGeometry(C, geom)                 // { uv (Float32 2n), on (Uint8 n), tris (Uint32 triangle corner list on the chart), level }
import { loopPlan } from '../../body/subdiv.js';

export const CHART_VERSION = 1;
const _cache = new Map();
export async function loadChart(base = new URL('../../../../assets/person/fine7/', import.meta.url).href) {
  if (_cache.has(base)) return _cache.get(base);
  const p = (async () => {
    const [meta, bin] = await Promise.all([fetch(base + 'head_chart.json').then(r => r.json()), fetch(base + 'head_chart.bin').then(r => r.arrayBuffer())]);
    const uv0 = new Float32Array(bin);
    return { meta, uv0, nb: meta.nVerts, tris0: Int32Array.from(meta.tris), aspect: meta.aspect, size4k: meta.size4k };
  })();
  _cache.set(base, p); return p;
}

// the parents (a, b) of each edge vertex of one Loop level, from its stencil rows (the two 3/8 entries; a boundary edge has two 1/2)
function edgeParents(L) {
  const { rowOff, col, w } = L.S, n0 = L.nIn, ne = L.nOut - L.nIn, par = new Int32Array(ne * 2);
  for (let e = 0; e < ne; e++) { const r = n0 + e; let k = 0;
    for (let j = rowOff[r]; j < rowOff[r + 1] && k < 2; j++) if (w[j] > 0.3) par[e * 2 + k++] = col[j]; }
  return par;
}
const ekey = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;

// chartOnGeometry(C, geom): the chart on a hero body geometry (level 0 = the 13k body, or a subdivided one carrying userData.plan)
export function chartOnGeometry(C, geom) {
  const n = geom.attributes.position.count, plan = geom.userData?.plan || null;
  let uv = new Float32Array(Math.max(n, C.nb) * 2), on = new Uint8Array(Math.max(n, C.nb));
  for (let v = 0; v < C.nb; v++) { const u = C.uv0[v * 2]; if (Number.isFinite(u)) { uv[v * 2] = u; uv[v * 2 + 1] = C.uv0[v * 2 + 1]; on[v] = 1; } }
  // chart triangles at level 0: the base triangle ids, as corner triples (the base index is hm08's idx_body, the first 26,756 triangles of plan.triIn)
  const triIn = plan ? plan.triIn : geom.index.array;
  let tris = new Uint32Array(C.tris0.length * 3), good = 0;
  for (let i = 0; i < C.tris0.length; i++) { const t = C.tris0[i]; tris[i * 3] = triIn[t * 3]; tris[i * 3 + 1] = triIn[t * 3 + 1]; tris[i * 3 + 2] = triIn[t * 3 + 2];
    if (on[tris[i * 3]] && on[tris[i * 3 + 1]] && on[tris[i * 3 + 2]]) good++; }
  if (good < 0.99 * C.tris0.length) {   // a base index not in hm08's order (a culled level-0 body): the chart's triangles from the vertices' flags
    const L = []; for (let i = 0; i < triIn.length; i += 3) if (on[triIn[i]] && on[triIn[i + 1]] && on[triIn[i + 2]]) L.push(triIn[i], triIn[i + 1], triIn[i + 2]);
    tris = Uint32Array.from(L); }
  if (plan) {
    for (const L of plan.levels) {
      const par = edgeParents(L), ne = L.nOut - L.nIn, edges = new Set();
      for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) edges.add(ekey(tris[i + k], tris[i + (k + 1) % 3]));
      const uv2 = new Float32Array(L.nOut * 2), on2 = new Uint8Array(L.nOut);
      uv2.set(uv.subarray(0, L.nIn * 2)); on2.set(on.subarray(0, L.nIn));
      const emap = new Map();
      for (let e = 0; e < ne; e++) { const a = par[e * 2], b = par[e * 2 + 1], v = L.nIn + e; emap.set(ekey(a, b), v);
        if (edges.has(ekey(a, b))) { uv2[v * 2] = 0.5 * (uv[a * 2] + uv[b * 2]); uv2[v * 2 + 1] = 0.5 * (uv[a * 2 + 1] + uv[b * 2 + 1]); on2[v] = 1; } }
      // the children of every chart triangle (Loop's 1 -> 4 split; the corner order of subdiv.js's oneLevel)
      const t2 = new Uint32Array(tris.length * 4);
      for (let i = 0, o = 0; i < tris.length; i += 3) { const a = tris[i], b = tris[i + 1], c = tris[i + 2], ab = emap.get(ekey(a, b)), bc = emap.get(ekey(b, c)), ca = emap.get(ekey(c, a));
        t2.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o); o += 12; }
      uv = uv2; on = on2; tris = t2;
    }
  }
  return { uv: uv.subarray(0, n * 2), on: on.subarray(0, n), tris, level: plan ? plan.levels.length : 0, n };
}

// the chart for the export's body (node, Cycles): the export writes the subdivided body in the plan's vertex order; rebuild the plan from
// hm08's base index (the hero data) with the same levels, then the same carrying rule
export function chartOnExport(C, triIn, nIn, levels) {
  const plan = levels ? loopPlan(triIn, nIn, levels, 'hm08:' + triIn.length + ':' + nIn) : null;
  const geom = { attributes: { position: { count: plan ? plan.nOut : nIn } }, userData: { plan }, index: { array: triIn } };
  return chartOnGeometry(C, geom);
}
