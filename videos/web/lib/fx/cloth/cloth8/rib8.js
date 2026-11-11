// CLOTH8 (round 7, 8 Oct): THE SWEATSHIRT'S PUSHED-UP SLEEVE GATHERED INTO ITS RIB CUFF ON THE FOREARM (stage 'rib', after 'sleeve',
// before 'relax'). What the bake had (L21, L14; node probes): below the elbow the sleeve's cloth is a FLATTENED tube whose plane the
// forearm passes through (the cloth only at two angles round the arm, ~7 cm off its line), and its free edge a small crumpled ring
// BESIDE the forearm (winding 0 round it); K4's rib cuff hung off that ring as a tube sticking out sideways (the AUDIT7 C6 "detached
// tubes"), and band8's rev 1 cuff, built from that ring, crossed itself (725 triangles). Here, per arm:
//   - the forearm's skin measured in sections (the forearm / hand skin of that side, every cm; per sector the farthest skin, low-passed,
//     about the section's own centre: the joints are not at the middle of the forearm)
//   - the sleeve's cloth from `cut` above the elbow to its free edge re-laid in the forearm's cylinder coordinates: the angle round the
//     arm from the sleeve's own FLAT PATTERN (its width at each height once round the arm from the underarm seam; the seam's angle and
//     the sense fitted on the round sleeve above: no twist, and a free edge that goes once round the arm by construction), the
//     position along the arm harmonic between the ring above and the cuff's top (`tTop`: the edge's own mean height on the arm), the
//     height over the skin harmonic between the sleeve's above and the rib cuff's top at the edge: a sleeve tapering into its cuff;
//     never nearer the skin than `skinGap`
//   - the cuff's frame and the sections handed to band8 (ctx.rib8), which lays the rib cuff from the edge down the forearm on the skin
// Vertices it lays are pinned for relax8. Plain data; ctx from rebuild8.   rib8(ctx) -> { 'top/L': report, ... }
import { SurfaceMesh } from '../collide.js';
export const RIB8_VERSION = 1;
export const RIB8 = { cut: 0.03, sectors: 36, harm: 4, slab: 0.006, step: 0.01, ease: 0.0045, skinGap: 0.0035, maxD: 0.16, minLoop: 10, iters: 1500, cuffH: 0.055, wristRoom: 0.012, armR: 0.16, minFit: 0.6, clear: 0.004 };
const TAU = Math.PI * 2, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function lowpass(a, H) { const K = a.length, out = new Float64Array(K); for (let k = 0; k <= H; k++) { let c = 0, s = 0; for (let j = 0; j < K; j++) { const th = TAU * k * j / K; c += a[j] * Math.cos(th); s += a[j] * Math.sin(th); } c *= (k === 0 ? 1 : 2) / K; s *= 2 / K; for (let j = 0; j < K; j++) { const th = TAU * k * j / K; out[j] += c * Math.cos(th) + (k === 0 ? 0 : s * Math.sin(th)); } } return out; }

// the forearm as a cylinder frame with measured sections: loc(p) -> [t, r, th] (t along elbow -> wrist in metres, r and th about the
// section centre at t); at(t, th, r) -> point; R(t, th): the skin's radius there (sector max, low-passed)
export function armFrame(J, body, sd, O = RIB8) {
  const E = J['elbow' + sd], Wr = J['wrist' + sd], La = Math.hypot(...sub(Wr, E)), ax = nrm(sub(Wr, E)), ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], b1 = nrm(cross(ax, ref)), b2 = cross(ax, b1), K = O.sectors;
  const ts = []; for (let t = 0; t <= La + 1e-9; t += O.step) ts.push(t); const pts = ts.map(() => []), arm = J['arm' + sd], BX = body.X;
  for (let v = 0; v < BX.length / 3; v++) { if (arm && !arm[v]) continue; const d = sub([BX[v * 3], BX[v * 3 + 1], BX[v * 3 + 2]], E), t = dot(d, ax), x = dot(d, b1), y = dot(d, b2); if (Math.hypot(x, y) > 0.08) continue; for (let k = 0; k < ts.length; k++) if (Math.abs(t - ts[k]) < O.slab) pts[k].push(x, y); }
  const secs = ts.map((t, k) => { const P = pts[k]; if (P.length < 12) return null; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < P.length; i += 2) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, Rs = new Float64Array(K), cnt = new Float64Array(K); for (let i = 0; i < P.length; i += 2) { const x = P[i] - cx, y = P[i + 1] - cy, r = Math.hypot(x, y), j = Math.floor((((Math.atan2(y, x) % TAU) + TAU) % TAU) / TAU * K) % K; if (r > Rs[j]) Rs[j] = r; cnt[j]++; }
    const m = Rs.reduce((a, b) => Math.max(a, b), 0); for (let j = 0; j < K; j++) if (!cnt[j]) Rs[j] = m; const Rl = lowpass(Rs, O.harm).map((r, j) => Math.max(r, Rs[j] - 0.001)); return { t, cx, cy, R: Rl }; });
  // fill sections the mask missed (near the elbow) from their neighbours
  for (let k = 0; k < secs.length; k++) if (!secs[k]) { let a = k - 1; while (a >= 0 && !secs[a]) a--; let b = k + 1; while (b < secs.length && !secs[b]) b++; const s = secs[a] || secs[b]; if (s) secs[k] = { ...s, t: ts[k], fill: true }; }
  const ok = secs.filter(Boolean); if (ok.length < 3) return null;
  const sec = t => { const f = Math.min(ok.length - 1, Math.max(0, (t - ok[0].t) / O.step)), i = Math.min(ok.length - 2, Math.floor(f)), w = Math.min(1, Math.max(0, f - i)); return [ok[i], ok[i + 1], w]; };
  const ctr = t => { const [a, b, w] = sec(t); return [a.cx + (b.cx - a.cx) * w, a.cy + (b.cy - a.cy) * w]; };
  const R = (t, th) => { const [a, b, w] = sec(t), f = ((((th % TAU) + TAU) % TAU) / TAU) * K, j = Math.floor(f) % K, j2 = (j + 1) % K, u = f - Math.floor(f), ra = a.R[j] + (a.R[j2] - a.R[j]) * u, rb = b.R[j] + (b.R[j2] - b.R[j]) * u; return ra + (rb - ra) * w; };
  const loc = p => { const d = sub(p, E), t = dot(d, ax), c = ctr(t), x = dot(d, b1) - c[0], y = dot(d, b2) - c[1]; return [t, Math.hypot(x, y), Math.atan2(y, x)]; };
  const at = (t, th, r) => { const c = ctr(t), x = c[0] + Math.cos(th) * r, y = c[1] + Math.sin(th) * r; return [E[0] + ax[0] * t + b1[0] * x + b2[0] * y, E[1] + ax[1] * t + b1[1] * x + b2[1] * y, E[2] + ax[2] * t + b1[2] * x + b2[2] * y]; };
  return { E, Wr, La, ax, b1, b2, loc, at, R, sections: ok.length };
}

// the drawn boundary loop of a welded garment nearest a point (closed, >= minLoop vertices, within maxD)
export function loopNear(Wg, Pw, c, O = RIB8) { let best = null, bd = Infinity; for (const L of Wg.loops) { if (L.ids.length < O.minLoop || !L.closed) continue; let m = [0, 0, 0]; for (const w of L.ids) for (let k = 0; k < 3; k++) m[k] += Pw[w * 3 + k] / L.ids.length; const d = Math.hypot(m[0] - c[0], m[1] - c[1], m[2] - c[2]); if (d < bd) { bd = d; best = L; } } return bd <= O.maxD ? { L: best, d: bd } : null; }

export function rib8(ctx) {
  const { parts, W, Pws, gar, P, bodySurf, body, J } = ctx, O = { ...RIB8, ...(ctx.O.rib || {}) }, rep = {}; if (!J || !body) return { skipped: 'no joints / body' };
  ctx.rib8 = new Map();
  for (const q of parts.filter(x => x.group === 'construction' && /^sweat\.cuff\.[LR]$/.test(x.name))) {
    const g = gar.find(x => x.owner === q.owner || x.name === q.owner); if (!g) continue; const Wg = W.get(g), Pw = Pws.get(g), m = Wg.m, key = g.name + '/' + q.name.slice(-1);
    // the side: the arm whose forearm line the old cuff is nearer
    const Pq = P(q), nq = Pq.length / 3; let cq = [0, 0, 0]; for (let v = 0; v < nq; v++) for (let c = 0; c < 3; c++) cq[c] += Pq[v * 3 + c] / nq;
    const dLine = sd => { const e = J['elbow' + sd], w = J['wrist' + sd], v = sub(w, e), f = Math.max(0, Math.min(1, dot(sub(cq, e), v) / dot(v, v))); return Math.hypot(...sub(cq, [e[0] + v[0] * f, e[1] + v[1] * f, e[2] + v[2] * f])); };
    const sd = dLine('L') <= dLine('R') ? 'L' : 'R', F = armFrame(J, body, sd, O); if (!F) { rep[key] = { skipped: 'no forearm sections' }; continue; }
    const hit = loopNear(Wg, Pw, cq, O); if (!hit) { rep[key] = { skipped: 'no edge loop' }; continue; } const ids = hit.L.ids;
    const pos = w => [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]], lw = ids.map(w => F.loc(pos(w)));
    // the cuff's top: the edge's mean height on the forearm, kept the cuff's height clear of the wrist
    const tTop = Math.max(0.05, Math.min(lw.reduce((s, x) => s + x[0], 0) / ids.length, F.La - O.wristRoom - O.cuffH));
    // the region: the sleeve's cloth reached from the edge through cloth lying below `cut` above the elbow (and near this arm's line)
    const nb = Array.from({ length: m }, () => []); for (let t = 0; t < Wg.T.length; t += 3) for (let k = 0; k < 3; k++) { const a = Wg.T[t + k], b = Wg.T[t + (k + 1) % 3]; nb[a].push(b); nb[b].push(a); }
    const L0 = new Float64Array(m * 3), inR = new Uint8Array(m), onEdge = new Uint8Array(m); for (const w of ids) onEdge[w] = 1;
    const near = w => { const l = F.loc(pos(w)); L0.set(l, w * 3); return l[0] > -O.cut && l[1] < O.armR; };
    let fr = []; for (const w of ids) { inR[w] = 1; near(w); fr.push(w); }
    while (fr.length) { const nx = []; for (const v of fr) for (const u of nb[v]) { if (inR[u]) continue; if (near(u)) { inR[u] = 1; nx.push(u); } } fr = nx; }
    const reg = []; for (let w = 0; w < m; w++) if (inR[w]) reg.push(w); const ring = new Set(); for (const w of reg) for (const u of nb[w]) if (!inR[u]) { ring.add(u); if (!L0[u * 3 + 1]) L0.set(F.loc(pos(u)), u * 3); }
    if (reg.length < ids.length + 10 || ring.size < 6) { rep[key] = { skipped: 'no sleeve region', region: reg.length, ring: ring.size }; continue; }
    // THE ANGLE ROUND THE ARM FROM THE SLEEVE'S OWN PATTERN (a harmonic unit vector down a tube this long kept none of its winding: the
    // k = 1 mode decays as exp(-2 pi length / girth) while the mean does not): the sleeve panel is flat and simply connected, its width
    // at each height runs once round the arm from the underarm seam; the seam's angle and the turn's sense fitted on the round ring above
    const sp = (() => { const c = new Map(); for (const w of ids) for (const i of Wg.dups[w]) c.set(g.panel[i], (c.get(g.panel[i]) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]; })();
    const ub = new Map(); for (let i = 0; i < g.X.length / 3; i++) { if (g.panel[i] !== sp) continue; const b = Math.round(g.uv[i * 2 + 1] / 0.01), e = ub.get(b) || [Infinity, -Infinity]; e[0] = Math.min(e[0], g.uv[i * 2]); e[1] = Math.max(e[1], g.uv[i * 2]); ub.set(b, e); }
    const frac = w => { const i = Wg.dups[w].find(j => g.panel[j] === sp); if (i == null) return null; const u = g.uv[i * 2], v = g.uv[i * 2 + 1], b = Math.round(v / 0.01); let e = ub.get(b); if (!e) return null; if (e[1] - e[0] < 0.02) return null; return Math.min(1, Math.max(0, (u - e[0]) / (e[1] - e[0]))); };
    let fit = null; for (const sg of [1, -1]) { let zx = 0, zy = 0, c = 0; for (const u of ring) { const f = frac(u); if (f == null) continue; const d = L0[u * 3 + 2] - sg * TAU * f; zx += Math.cos(d); zy += Math.sin(d); c++; } if (!c) continue; const R1 = Math.hypot(zx, zy) / c; if (!fit || R1 > fit.R1) fit = { sg, th0: Math.atan2(zy, zx), R1, c }; }
    if (!fit || fit.R1 < O.minFit) { rep[key] = { skipped: 'the ring does not follow the pattern round the arm', fit }; continue; }
    const thOf = new Map(); let nPat = 0; for (const w of reg) { const f = frac(w); if (f == null) { thOf.set(w, L0[w * 3 + 2]); continue; } thOf.set(w, fit.th0 + fit.sg * TAU * f); nPat++; }
    // the height along the arm and the lift over the skin: harmonic (Dirichlet on the ring; at the edge t = tTop, lift 0)
    // (and the ring's own deviation from the pattern's angle, faded harmonically to 0 at the edge: the laid cloth meets the round sleeve
    // above without a step)
    const val = new Map(); for (const u of ring) { const t = L0[u * 3], r = L0[u * 3 + 1], th = L0[u * 3 + 2], f = frac(u), dv = f == null ? 0 : th - (fit.th0 + fit.sg * TAU * f); val.set(u, [t, Math.max(0, r - F.R(t, th) - O.ease), Math.atan2(Math.sin(dv), Math.cos(dv))]); }
    for (const w of reg) val.set(w, [onEdge[w] ? tTop : L0[w * 3], 0, 0]);
    for (let it = 0; it < O.iters; it++) for (const w of reg) { if (onEdge[w]) continue; let t = 0, l = 0, e = 0, c = 0; for (const u of nb[w]) { const v = val.get(u); if (!v) continue; t += v[0]; l += v[1]; e += v[2]; c++; } if (c) { const v = val.get(w); v[0] = t / c; v[1] = l / c; v[2] = e / c; } }
    for (const w of reg) if (!onEdge[w] && frac(w) != null) thOf.set(w, thOf.get(w) + val.get(w)[2]);
    let wind = 0; for (let i = 0; i < ids.length; i++) { let d = thOf.get(ids[(i + 1) % ids.length]) - thOf.get(ids[i]); d = Math.atan2(Math.sin(d), Math.cos(d)); wind += d; } const windDeg = Math.round(wind * 180 / Math.PI);
    if (Math.abs(Math.abs(windDeg) - 360) > 30) { rep[key] = { skipped: 'edge does not wind round the arm', windDeg }; continue; }
    // laid: the point at (t, th, the skin + ease + lift), never nearer the skin than skinGap; pinned for relax8
    const pin = ctx.pin?.get(g) || new Uint8Array(m); (ctx.pin ||= new Map()).set(g, pin); let moved = 0, mx = 0, pushed = 0;
    const laid = ctx.rib8Laid?.get(g) || new Uint8Array(m); (ctx.rib8Laid ||= new Map()).set(g, laid);   // (c3 it2: resolve8 frees the laid sleeve to gather)
    // what else lies beside the arm (the garment's own body cloth, the other garments, the rib hem band at the hip: L14's hands hang by her
    // hips): the laid sleeve kept `clear` inside it along its own ray from the arm (never nearer the skin than skinGap)
    const XO = [], TO = []; const addS = (X, T, skip) => { const o = XO.length / 3; for (let i = 0; i < X.length; i++) XO.push(X[i]); for (let t = 0; t < T.length; t += 3) { if (skip && (skip[T[t]] || skip[T[t + 1]] || skip[T[t + 2]])) continue; TO.push(T[t] + o, T[t + 1] + o, T[t + 2] + o); } };
    addS(Pw, Wg.T, inR); for (const x of gar) if (x !== g) addS(Pws.get(x), W.get(x).T, null); for (const x of parts) if (x.group === 'construction' && !/^sweat\.(cuff\.[LR]|neckband)$/.test(x.name) && x.T.length) addS(P(x), x.T, null);
    const obst = O.clear > 0 && TO.length ? new SurfaceMesh(Float64Array.from(XO), Int32Array.from(TO), { cell: 0.02, boundary: false }) : null; let kept = 0, stuck = 0;
    for (const w of reg) { const v = val.get(w), th = thOf.get(w), t = v[0], r0 = F.R(t, th) + O.skinGap; let r = Math.max(r0, F.R(t, th) + O.ease + v[1]);
      if (obst) for (let rr = r0; rr <= r; rr += 0.001) { const a = F.at(t, th, rr), qq = obst.closestAny(a[0], a[1], a[2], 2 * O.clear); if (qq && Math.abs(qq.d) < O.clear) { if (rr < r) { r = Math.max(r0, rr - 0.001); kept++; if (rr <= r0 + 1e-9) stuck++; } break; } }
      const p = F.at(t, th, r);
      if (bodySurf) { const qq = bodySurf.closestAny(p[0], p[1], p[2], 0.05); if (qq && !qq.edge && qq.d < O.skinGap) { const k = O.skinGap - qq.d; p[0] += qq.nx * k; p[1] += qq.ny * k; p[2] += qq.nz * k; pushed++; } }
      const dd = Math.hypot(p[0] - Pw[w * 3], p[1] - Pw[w * 3 + 1], p[2] - Pw[w * 3 + 2]); mx = Math.max(mx, dd); moved++; for (let c = 0; c < 3; c++) Pw[w * 3 + c] = p[c]; pin[w] = 1; laid[w] = 1; }
    ctx.rib8.set(q, { side: sd, F, ids, tTop, th: ids.map(w => thOf.get(w)) });
    rep[key] = { side: sd, panel: sp, fit: +fit.R1.toFixed(2), byPattern: nPat, loop: ids.length, region: reg.length, ring: ring.size, windDeg, tTopCm: +(tTop * 100).toFixed(1), forearmCm: +(F.La * 100).toFixed(1), moved, maxMoveCm: +(mx * 100).toFixed(1), pushed, keptClear: kept, stuck, sections: F.sections };
    ctx.log('rib8', key, JSON.stringify(rep[key])); }
  return rep;
}
