// geo/network: rail, grid, or any node/edge graph in map space, lit outward by graph distance (Dijkstra).
//   const rail = Network.rail(geo, us, { root: 'Chicago', arc: 0.12 });   rail.flag === 'approx'
//   const grid = Network.grid(geo, us);                                     grid.flag === 'procedural'
//   rail.draw(ctx, { cam, reveal, t, pulses, width, glowW, nodes });
import { C, clamp, lerp } from '../../kit.js';
import { hash, camApply, TAU, FLAGS } from './data.js';

// ================================================================ networks (rail / grid / anything with nodes + edges)
// Nodes in map space; reveal grows out from `root` by graph distance (Dijkstra), so a network "lights" outward.
export class Network {
  constructor(nodes, edges, { root = 0, arc = 0, chains = null } = {}) {
    this.n = nodes; this.e = edges; this.arc = arc; this.chains = chains; this.flag = 'real';
    const adj = nodes.map(() => []);
    edges.forEach(([a, b], i) => { const L = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]); adj[a].push([b, L]); adj[b].push([a, L]); });
    const roots = Array.isArray(root) ? root : [root];
    const d = new Float64Array(nodes.length).fill(Infinity); for (const r of roots) d[r] = 0;
    const done = new Uint8Array(nodes.length);
    for (;;) {                                        // O(n^2) Dijkstra: fine for a few thousand nodes, once
      let u = -1; for (let i = 0; i < d.length; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0) break; done[u] = 1;
      for (const [v, L] of adj[u]) if (d[u] + L < d[v]) d[v] = d[u] + L;
    }
    this.d = d; this.maxD = Math.max(...[...d].filter(Number.isFinite));
    this.len = edges.map(([a, b]) => Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]));
    this.deg = adj.map(a => a.length);
  }
  // real Class I main lines: towns are shared nodes, so junctions connect
  static rail(G, map, { root = 'Chicago', arc = 0.1 } = {}) {
    const key = p => p[0] + ',' + p[1], idx = new Map(), nodes = [], edges = [], chains = [];
    const node = ll => { const k = key(ll); if (!idx.has(k)) { const p = map.project(ll); if (!p) return -1; idx.set(k, nodes.length); nodes.push(p); } return idx.get(k); };
    for (const [name, pts] of Object.entries(G.us.rail)) {
      const ch = pts.map(node).filter(i => i >= 0); chains.push({ name, ids: ch });
      for (let i = 1; i < ch.length; i++) edges.push([ch[i - 1], ch[i]]);
    }
    const r = node(G.us.railTowns[root]);
    const net = new Network(nodes, edges, { root: r, arc, chains });
    net.flag = FLAGS.rail;
    net.names = Object.fromEntries(Object.entries(G.us.railTowns).map(([k, ll]) => [idx.get(key(ll)), k]));
    return net;
  }
  // the grid: MST + near-neighbour ties over every town >= 10k (procedural topology on real towns)
  static grid(G, map, { roots = null } = {}) {
    const T = G.us.grid.towns, keep = [], nodes = [];
    T.forEach((t, i) => { const p = map.project([t[0], t[1]]); keep[i] = p ? nodes.push(p) - 1 : -1; });
    const edges = G.us.grid.edges.map(([a, b]) => [keep[a], keep[b]]).filter(([a, b]) => a >= 0 && b >= 0);
    const big = T.map((t, i) => [t[2], keep[i]]).filter(x => x[1] >= 0).sort((a, b) => b[0] - a[0]);
    const net = new Network(nodes, edges, { root: roots || big.slice(0, 12).map(x => x[1]) });
    net.flag = FLAGS.grid;
    net.pop = nodes.map(() => 0); T.forEach((t, i) => { if (keep[i] >= 0) net.pop[keep[i]] = t[2]; });
    return net;
  }
  _pt(a, b, u, arc) {                                   // point on the (optionally arched) edge a->b at u
    const A = this.n[a], B = this.n[b];
    if (!arc) return [lerp(A[0], B[0], u), lerp(A[1], B[1], u)];
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, dx = B[0] - A[0], dy = B[1] - A[1];
    const cx = mx - dy * arc, cy = my + dx * arc, v = 1 - u;
    return [v * v * A[0] + 2 * v * u * cx + u * u * B[0], v * v * A[1] + 2 * v * u * cy + u * u * B[1]];
  }
  _seg(path, a, b, u0, u1, arc) {
    const steps = arc ? Math.max(2, Math.ceil((u1 - u0) * 10)) : 1;
    const p0 = this._pt(a, b, u0, arc); path.moveTo(p0[0], p0[1]);
    for (let k = 1; k <= steps; k++) { const p = this._pt(a, b, lerp(u0, u1, k / steps), arc); path.lineTo(p[0], p[1]); }
  }
  // reveal: graph distance (map px) the light has travelled; widths are in screen px.
  // color: core colour, glow: glow colour; pulses: number of travelling packets per chain / edge sample
  draw(ctx, { cam, reveal = Infinity, t = 0, color = '#fff0d8', glow = C.red2, width = 2.2, glowW = 12, alpha = 1,
    pulses = 0, pulseSpeed = 180, heads = true, nodes = 0, blend = 'lighter' } = {}) {   // blend 'source-over' on light grounds (poster, engraving)
    ctx.save(); const z = camApply(ctx, cam);
    const full = new Path2D(), tips = [];
    this.e.forEach(([a, b], i) => {
      let [p, q] = this.d[a] <= this.d[b] ? [a, b] : [b, a];
      const d0 = this.d[p], d1 = d0 + this.len[i];
      if (reveal <= d0) return;
      const u = clamp((reveal - d0) / (d1 - d0 || 1));
      const arc = this.arc * (p === a ? 1 : -1);
      this._seg(full, p, q, 0, u, arc);
      if (u < 1) tips.push(this._pt(p, q, u, arc));
    });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = blend;
    ctx.strokeStyle = glow; ctx.globalAlpha = 0.16 * alpha; ctx.lineWidth = glowW * 1.8 / z; ctx.stroke(full);
    ctx.globalAlpha = 0.35 * alpha; ctx.lineWidth = glowW * 0.6 / z; ctx.stroke(full);
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width / z; ctx.stroke(full);
    if (heads) for (const [x, y] of tips) {
      ctx.fillStyle = glow; ctx.globalAlpha = 0.45 * alpha; ctx.beginPath(); ctx.arc(x, y, 9 / z, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, 3.2 / z, 0, TAU); ctx.fill();
    }
    if (nodes) {                                          // junction/town nodes that are already lit
      ctx.fillStyle = color;
      for (let i = 0; i < this.n.length; i++) if (this.d[i] < reveal && this.deg[i] >= nodes) {
        const s = (this.deg[i] > 2 ? 4.5 : 2.5) / z; ctx.globalAlpha = alpha * clamp((reveal - this.d[i]) / 60);
        ctx.fillRect(this.n[i][0] - s, this.n[i][1] - s, 2 * s, 2 * s);
      }
    }
    if (pulses) this._pulses(ctx, z, reveal, t, pulses, pulseSpeed, alpha, blend);
    ctx.restore();
  }
  // packets: along chains when the network has them (trains), otherwise along a deterministic sample of edges
  _pulses(ctx, z, reveal, t, n, speed, alpha, blend = 'lighter') {
    ctx.globalCompositeOperation = blend;
    const runs = this.chains ? this.chains.map(c => c.ids) : this.e.filter((_, i) => hash(i, 7) < n / this.e.length * 6).map(e => [...e]);
    runs.forEach((ids, ci) => {
      const segs = []; let L = 0;
      for (let i = 1; i < ids.length; i++) { const l = Math.hypot(this.n[ids[i]][0] - this.n[ids[i - 1]][0], this.n[ids[i]][1] - this.n[ids[i - 1]][1]); segs.push([ids[i - 1], ids[i], L, l]); L += l; }
      const k = this.chains ? n : 1;
      for (let j = 0; j < k; j++) {
        const dir = (ci + j) % 2 ? 1 : -1;
        let s = ((t * speed * (0.7 + hash(ci, j) * 0.6) + hash(j, ci) * L) % L + L) % L; if (dir < 0) s = L - s;
        for (let tr = 0; tr < 8; tr++) {                // head + fading trail
          const ss = s - dir * tr * 5 / z; if (ss < 0 || ss > L) continue;
          const sg = segs.find(g => ss >= g[2] && ss <= g[2] + g[3]); if (!sg) continue;
          const u = (ss - sg[2]) / sg[3];
          if (this.d[sg[0]] + u * sg[3] > reveal && this.d[sg[1]] + (1 - u) * sg[3] > reveal) continue;
          const p = this._pt(sg[0], sg[1], u, 0);
          const a = alpha * (1 - tr / 8), s2 = (tr ? 2.6 : 4.2) / z;
          ctx.fillStyle = tr ? `rgba(255,120,90,${a})` : `rgba(255,255,255,${a})`;
          ctx.fillRect(p[0] - s2, p[1] - s2, 2 * s2, 2 * s2);
        }
      }
    });
    ctx.globalCompositeOperation = 'source-over';
  }
}
