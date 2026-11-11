// TRIM4 (CLOTHING K4, the wardrobe): the construction that makes each garment read as what it is, built on the SOLVED, posed cloth (as K3's
// finish.js and CLOTH4's cloth4.js build theirs) and taken to bind through the cloth particle each piece rides (finish.js partFrom):
//   knit bands    a tee's 1x1 rib neckband; a sweatshirt's rib cuffs, hem band and neckband (two layers of rib, the band narrowing a little
//                 from the cloth it is sewn to: the sleeve and body blouse over it); a scrub top's bias-bound neck
//   hems          turned hems (a rounded fold, the turned layer inside) on every free edge the garment's own construction does not finish
//   pockets       patches laid ON the cloth by its flat-pattern coordinates (each panel's uv: the pocket sits where a tailor marks it, and
//                 follows the drape): jeans' back pockets, coin pocket, a chore coat's hip and chest pockets, a scrub top's chest pocket;
//                 a rolled edge round each and its topstitching
//   openings      the jeans' scooped front pocket mouths, the chinos' slant pocket mouths and back welts: a rolled edge on the cloth and
//                 the stitching beside it
//   stitching     thread ribbons on the cloth (denim's gold double rows: the back yoke, the pocket edges, the fly's J), 1 mm wide
//   hardware      copper rivets at the jeans' pocket corners, a chore coat's buttons down the button front and its buttonholes opposite
// Every piece is its own part (group 'construction', marked sewn), in the garment's own fabric (a thread or rivet colour where it is one).
// Opt-in: only wardrobe4/bake4.js calls this.
import * as FIN from '../finish.js';
import { boneMats, skinPose, SurfaceMesh } from '../collide.js';
import { sweep, loopFrame, bindingProfile, orientFrom } from '../foundations.js';
import { triangulate } from '../pattern/mesh2d.js';
export const TRIM4_VERSION = 1;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const THREAD = { denim: '#c08a32', stretchDenim: '#c08a32', canvas: '#a8875a', duck: '#b8955a' };

export function trimAll(h, Sx, parts, G, { scale, sex = 'm', log = () => {}, waistHidden = false } = {}) {
  h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), rep = {}, body = bodySurface(h, M, scale);
  for (const role of ['bottom', 'top', 'outer']) { const g = G[role]; if (!g?.rec || !g.Gd.trim) continue; const fn = TRIMS[g.Gd.trim]; if (!fn) continue;
    const C = ctxOf(h, g, M, scale, body, parts, role); C.unders = role === 'top' && !waistHidden ? [] : role === 'top' ? [Sx.recs.get('trousers')?.surf].filter(Boolean) : []; try { rep[role] = fn(C, { sex, waistHidden, role, outer: G.outer || null }); } catch (e) { rep[role] = { error: String(e.message || e) }; log('trim4', role, 'FAILED', e.stack?.split('\n').slice(0, 3).join(' | ')); } }
  return rep;
}
function bodySurface(h, M, scale) { const g = h.body.geometry, P = g.attributes.position.array, n = P.length / 3, X = skinPose(Float64Array.from(P), g.attributes.skinIndex.array, g.attributes.skinWeight.array, M, new Float64Array(n * 3), scale);
  return new SurfaceMesh(X, Int32Array.from(g.index.array), { cell: 0.02 }); }

// ---------------------------------------------------------------- the context: a solved garment with its flat panels
function ctxOf(h, g, M, scale, body, parts, role) {
  const rec = g.rec, Gs = FIN.solved(h, rec), pat = rec.L.pattern, W = rec.pattern, off = {}; let o = 0;
  for (const pn of pat.panels) { off[pn.name] = o; o += pn.uv.length / 2; }
  const color = g.color, fabric = g.fabric, thread = THREAD[fabric] || shade(color, fabric === 'chino' || fabric === 'twillPC' ? 0.78 : 0.85);
  const C = { h, g, rec, Gs, pat, W, off, M, scale, body, parts, role, color, fabric, thread, id: rec.L.id, n: 0 };
  C.add = (S, srcIds, name, construction, extra = {}) => { const q = FIN.partFrom(h, rec, S, srcIds, name, construction, extra.color || color, extra.fabric || fabric, scale, M, extra.solid ? { solid: true } : {}); parts.push({ ...q, group: 'construction', sewn: 1, k4: construction }); C.n++; return q; };
  // the flat-pattern uv of a named point (the garment's tag), and a panel's outline as uv
  C.tag = (panel, tag) => { const p = g.g.panels.find(q => q.name === panel); const v = p?.boundary?.tags?.[tag]; return v == null ? null : [g.g.V2[v * 2], g.g.V2[v * 2 + 1]]; };
  C.panel = name => pat.panels.find(q => q.name === name);
  // a point given in a panel's flat coordinates -> the posed cloth (barycentric in the panel's triangle), its normal, the nearest particle
  const cache = new Map();
  C.on = (panel, u, v) => { const pn = C.panel(panel); if (!pn) return null; const o0 = off[panel], T = pn.tris, U = pn.uv;
    let tri = cache.get(panel); if (!tri) { tri = buildLookup(U, T); cache.set(panel, tri); }
    const hit = tri.find(u, v); if (!hit) return null; const [t, b0, b1, b2] = hit, ia = T[t * 3], ib = T[t * 3 + 1], ic = T[t * 3 + 2], wa = W.map[o0 + ia], wb = W.map[o0 + ib], wc = W.map[o0 + ic];
    const X = Gs.X, N = Gs.N, p = [0, 1, 2].map(k => X[wa * 3 + k] * b0 + X[wb * 3 + k] * b1 + X[wc * 3 + k] * b2), nn = nrm([0, 1, 2].map(k => N[wa * 3 + k] * b0 + N[wb * 3 + k] * b1 + N[wc * 3 + k] * b2));
    return { p, n: nn, src: b0 >= b1 && b0 >= b2 ? wa : b1 >= b2 ? wb : wc }; };
  return C;
}
function buildLookup(U, T) { const nt = T.length / 3, cell = 0.03, grid = new Map(), key = (i, j) => i * 100003 + j;
  for (let t = 0; t < nt; t++) { let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (let k = 0; k < 3; k++) { const a = T[t * 3 + k]; u0 = Math.min(u0, U[a * 2]); u1 = Math.max(u1, U[a * 2]); v0 = Math.min(v0, U[a * 2 + 1]); v1 = Math.max(v1, U[a * 2 + 1]); }
    for (let i = Math.floor(u0 / cell); i <= Math.floor(u1 / cell); i++) for (let j = Math.floor(v0 / cell); j <= Math.floor(v1 / cell); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); } }
  return { find(u, v) { const L = grid.get(key(Math.floor(u / cell), Math.floor(v / cell))) || []; let best = null, bd = Infinity;
    for (const t of L) { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], ax = U[a * 2], ay = U[a * 2 + 1], bx = U[b * 2], by = U[b * 2 + 1], cx = U[c * 2], cy = U[c * 2 + 1];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-14) continue; const l0 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / d, l1 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / d, l2 = 1 - l0 - l1;
      const out = Math.max(0, -l0) + Math.max(0, -l1) + Math.max(0, -l2); if (out < bd) { bd = out; best = [t, clamp(l0), clamp(l1), clamp(l2)]; if (out === 0) break; } }
    if (!best || bd > 0.05) return null; const s = best[1] + best[2] + best[3] || 1; return [best[0], best[1] / s, best[2] / s, best[3] / s]; } }; }
function shade(hex, k) { const c = parseInt(hex.slice(1), 16), r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, f = x => Math.max(0, Math.min(255, Math.round(x * k))).toString(16).padStart(2, '0'); return '#' + f(r) + f(g) + f(b); }
// keep points outside the posed body by gap (along the body normal)
function outOfBody(X, body, gap) { for (let v = 0; v < X.length / 3; v++) { const q = body.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.03); if (!q || q.edge) continue; if (q.d < gap) { const k = gap - q.d; X[v * 3] += q.nx * k; X[v * 3 + 1] += q.ny * k; X[v * 3 + 2] += q.nz * k; } } }

// ---------------------------------------------------------------- pieces
// a patch (pocket) over a uv polygon on a panel: the cloth's surface lifted by `lift`, a rolled rim, stitching inset `st` (one or two rows)
function patch(C, panel, poly, name, { lift = 0.0011, rim = 0.0011, rows = [0.004], h = 0.008, color = null, fabric = null } = {}) {
  const B = Float64Array.from(ccw(poly).flat()), m = triangulate(B, h, {}), X = [], src = [], ok = [];
  for (let i = 0; i < m.n; i++) { const q = C.on(panel, m.V[i * 2], m.V[i * 2 + 1]); if (!q) { ok.push(0); X.push(0, 0, 0); src.push(0); continue; } ok.push(1); X.push(...add(q.p, scl(q.n, lift))); src.push(q.src); }
  if (ok.filter(Boolean).length < m.n * 0.9) return null;
  // vertices off the panel take their neighbours' mean (a pocket corner past a seam)
  for (let it = 0; it < 3; it++) for (let i = 0; i < m.n; i++) if (!ok[i]) { let s = [0, 0, 0], k = 0; for (let t = 0; t < m.T.length; t += 3) if ([m.T[t], m.T[t + 1], m.T[t + 2]].includes(i)) for (const j of [m.T[t], m.T[t + 1], m.T[t + 2]]) if (ok[j]) { s = add(s, [X[j * 3], X[j * 3 + 1], X[j * 3 + 2]]); k++; } if (k) { X[i * 3] = s[0] / k; X[i * 3 + 1] = s[1] / k; X[i * 3 + 2] = s[2] / k; ok[i] = 2; } }
  const Xa = Float64Array.from(X), Ta = Int32Array.from(m.T), mid = cent(Xa); orientOutward(Xa, Ta, C, panel, poly);
  void mid; C.add({ X: Xa, T: Ta, src: Int32Array.from({ length: m.n }, (_, i) => i) }, src, name, 'pocket', { color, fabric });
  // the rim: a small rolled edge round the outline (its own sweep on the cloth)
  edgeLine(C, panel, poly, name + '.edge', { closed: true, prof: rimProfile(rim), lift: lift * 0.5, color, fabric });
  for (const r of rows) stitchLine(C, panel, inset(poly, r), name + '.st' + Math.round(r * 1000), { closed: true });
  return true;
}
// a line on a panel (uv polyline) as a swept profile on the cloth: prof [[side, up], ...] in metres
function edgeLine(C, panel, poly, name, { closed = false, prof, lift = 0, step = 0.004, color = null, fabric = null, solid = false, construction = 'edge' } = {}) {
  const pts = resample(poly, step, closed), P = [], Nn = [], src = []; for (const q of pts) { const r = C.on(panel, q[0], q[1]); if (!r) continue; P.push(add(r.p, scl(r.n, lift))); Nn.push(r.n); src.push(r.src); }
  if (P.length < 3) return null; const m = P.length, Tg = P.map((q, i) => nrm(sub(P[closed ? (i + 1) % m : Math.min(m - 1, i + 1)], P[closed ? (i - 1 + m) % m : Math.max(0, i - 1)]))), Sd = P.map((q, i) => nrm(cross(Nn[i], Tg[i])));
  const S = sweep(P, Nn, Sd, prof, closed); return C.add(S, src, name, construction, { color, fabric, solid });
}
const rimProfile = r => [[-0.0012, 0], [-0.0009, r * 0.8], [0, r], [0.0009, r * 0.8], [0.0012, 0]];
const threadProfile = (w = 0.0011, t = 0.00035) => [[-w / 2, 0], [-w / 2, t], [w / 2, t], [w / 2, 0]];
function stitchLine(C, panel, poly, name, { closed = false, lift = 0.0009, color = null } = {}) { return edgeLine(C, panel, poly, name, { closed, prof: threadProfile(), lift, step: 0.003, color: color || C.thread, fabric: 'teeJersey', construction: 'stitch' }); }
function rivet(C, panel, u, v, name) { const q = C.on(panel, u, v); if (!q) return null; const bt = FIN.buttonGeom(add(q.p, scl(q.n, 0.0008)), q.n, 0.0036, 0.0021, 12); return C.add({ X: bt.X, T: bt.T, src: new Int32Array(bt.X.length / 3) }, [q.src], name, 'rivet', { color: '#a06a3a', fabric: 'leather', solid: true }); }
function button(C, panel, u, v, name, { r = 0.0085, color = '#3b2f25' } = {}) { const q = C.on(panel, u, v); if (!q) return null; const bt = FIN.buttonGeom(add(q.p, scl(q.n, 0.0016)), q.n, r, 0.0032, 16); return C.add({ X: bt.X, T: bt.T, src: new Int32Array(bt.X.length / 3) }, [q.src], name, 'button', { color, fabric: 'leather', solid: true }); }
// a band swept from a boundary loop of the solved cloth: `H` beyond the edge (u < 0) or along `dir`, narrowing by `taper` (fraction of the
// radius) at its far edge, two layers `t` thick; or a turned hem (prof given: u into the cloth)
// loopFrame's `I` turns with the loop's direction (boundaryLoops does not fix it): point it INTO the cloth, by the loop vertices' interior
// neighbours (the cloth's triangles), one sign for the whole loop
function frameIn(C, ids, closed, smooth) { const fr = loopFrame(ids, C.Gs.X, C.Gs.N, closed, smooth), on = new Set(ids), nb = new Map(); for (const v of ids) nb.set(v, [0, 0, 0, 0]);
  const T = C.Gs.W.tris, X = C.Gs.X; for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = T[t + k]; if (!nb.has(a)) continue; for (const b of [T[t + (k + 1) % 3], T[t + (k + 2) % 3]]) { if (on.has(b)) continue; const q = nb.get(a); q[0] += X[b * 3]; q[1] += X[b * 3 + 1]; q[2] += X[b * 3 + 2]; q[3]++; } }
  let s = 0; ids.forEach((v, i) => { const q = nb.get(v); if (!q[3]) return; s += dot(fr.I[i], [q[0] / q[3] - X[v * 3], q[1] / q[3] - X[v * 3 + 1], q[2] / q[3] - X[v * 3 + 2]]); });
  if (s < 0) fr.I = fr.I.map(d => scl(d, -1)); return fr; }
function loopOf(C, test) { const Gs = C.Gs; let best = null, bk = 0; for (const L of Gs.loops) { const k = L.ids.filter(test).length; if (k > bk) { bk = k; best = L; } } return best && bk > 5 ? best : null; }
function band(C, L, name, { H = 0.016, taper = 0.0, t = 0.0012, over = 0.005, dir = null, fabric = 'rib', color = null, gap = 0.0015 } = {}) {
  const fr = frameIn(C, L.ids, L.closed, 3), m = fr.P.length; let c = [0, 0, 0]; for (const q of fr.P) c = add(c, scl(q, 1 / m));
  const D = fr.P.map((q, i) => { const out = scl(fr.I[i], -1), d = dir ? nrm(add(scl(nrm(dir), 0.7), scl(out, 0.3))) : out, r = sub(c, q), rl = len(r) || 1; return nrm(add(d, scl(r, taper * rl / H / rl))); });
  // the profile in (D, N): from `over` back onto the cloth to H beyond it, two layers; the far edge rounded
  const prof = [[-over, t], [H * 0.5, t * 1.05], [H - t, t], [H, 0], [H - t, -t], [H * 0.5, -t * 1.05], [-over, -t]];
  const S = sweep(fr.P, fr.N, D.map(d => d), prof.map(([u, v]) => [u, v]), L.closed); outOfBody(S.X, C.body, gap);
  return C.add(S, L.ids, name, 'band', { fabric, color });
}
// a knit RIB TUBE at an opening (a sweatshirt's cuff, its hem band): a smooth band round the opening's axis `a` (the forearm, or down):
// per sector of angle round the axis the opening's radius and axial position (the loop's particles), low-passed (harm harmonics) so the
// band is a smooth tube and not the cloth's wavy edge; from `over` above the edge (it covers the last of the cloth) to H beyond it,
// narrowing by `taper` (fraction of the radius) and never closer than `gap` to the body; two layers t thick, the far edge folded round.
// The garment's own cloth under the band (within `over` of the edge, inside the band) is dropped from its index.
function ribTube(C, L, name, { a, H = 0.065, taper = 0.12, t = 0.0016, over = 0.012, harm = 3, K = 40, gap = 0.003, color = null, fabric = 'rib' } = {}) {
  const X = C.Gs.X, ids = L.ids; let c = [0, 0, 0]; for (const v of ids) c = add(c, scl([X[v * 3], X[v * 3 + 1], X[v * 3 + 2]], 1 / ids.length));
  a = nrm(a); const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], b1 = nrm(cross(a, ref)), b2 = cross(a, b1), TAU = Math.PI * 2;
  const loc = p => { const d = sub(p, c); return [dot(d, a), Math.atan2(dot(d, b2), dot(d, b1)), Math.hypot(dot(d, b1), dot(d, b2))]; }, sec = th => Math.floor((((th % TAU) + TAU) % TAU) / TAU * K) % K;
  const rs = new Float64Array(K), ts = new Float64Array(K), cn = new Float64Array(K), src = new Int32Array(K).fill(-1);
  for (const v of ids) { const [tt, th, r] = loc([X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]), j = sec(th); rs[j] = Math.max(rs[j], r); ts[j] += tt; cn[j]++; src[j] = v; }
  for (let j = 0; j < K; j++) if (cn[j]) ts[j] /= cn[j];
  fill(rs, cn); fill(ts, cn); for (let j = 0; j < K; j++) if (src[j] < 0) { for (let k = 1; k < K; k++) { if (src[(j + k) % K] >= 0) { src[j] = src[(j + k) % K]; break; } if (src[(j - k + K) % K] >= 0) { src[j] = src[(j - k + K) % K]; break; } } }
  const R0 = lowpass(rs, harm).map((r, j) => Math.max(r, rs[j] - 0.004) + 0.0015), T0 = lowpass(ts, harm);
  // the profile (axial u from the edge, radial dr), outer face down, the fold, inner face back up
  const prof = [[-over, t * 0.6], [-over * 0.5, t], [H * 0.5, t], [H - t, t * 0.8], [H, 0], [H - t, -t * 0.8], [H * 0.5, -t], [-over * 0.5, -t], [-over, -t * 0.6]];
  const P = [], srcV = [], Tt = [], NP = prof.length;
  for (let j = 0; j <= K; j++) { const jj = j % K, th = (jj + 0.5) / K * TAU, dirR = add(scl(b1, Math.cos(th)), scl(b2, Math.sin(th)));
    for (const [u, dr] of prof) { const f = clamp(u / H), r = R0[jj] * (1 - taper * f * f * (3 - 2 * f)) + dr; P.push(add(add(c, scl(a, T0[jj] + u)), scl(dirR, r))); srcV.push(src[jj]); } }
  for (let j = 0; j < K; j++) for (let k = 0; k < NP; k++) { const k2 = (k + 1) % NP, i0 = j * NP + k, i1 = j * NP + k2, i2 = (j + 1) * NP + k, i3 = (j + 1) * NP + k2; Tt.push(i0, i2, i1, i1, i2, i3); }
  const Xa = Float64Array.from(P.flat()), Ta = Int32Array.from(Tt); outOfBody(Xa, C.body, gap);
  orientFrom(Xa, Ta, tt => { const j = Math.min(K - 1, Math.floor(Ta[tt * 3] / NP)), th = (j + 0.5) / K * TAU; return add(add(c, scl(a, T0[j] + H * 0.4)), scl(add(scl(b1, Math.cos(th)), scl(b2, Math.sin(th))), R0[j] * (1 - taper * 0.4))); });
  C.add({ X: Xa, T: Ta, src: Int32Array.from({ length: P.length }, (_, i) => i) }, srcV, name, 'band', { fabric, color });
  // the cloth under the band: the garment part's triangles near this opening, past the band's top (axially) and inside its outer face
  const hidden = hideIn(C, p => { const [tt, th, r] = loc(p), j = sec(th); return tt > T0[j] - over * 0.75 && r < R0[j] + t + 0.012 && tt < T0[j] + H + 0.01; });
  // the trousers under an untucked top's band: their cloth inside the band (it came through the band's lower edge, jagged) is not drawn
  // (pushing the band out of them instead turned its faces: black shards)
  const hiddenUnder = C.unders?.length ? hideIn(C, p => { const [tt, th, r] = loc(p), j = sec(th); return tt > T0[j] - over && r < R0[j] * (1 - taper * 0.5) + t + 0.004 && tt < T0[j] + H + 0.004; }, 'trousers') : 0;
  return { sectors: K, radiusMm: +(R0.reduce((x, y) => x + y, 0) / K * 1000).toFixed(1), hidden, hiddenUnder };
}
function fill(a, cn) { const K = a.length; if (![...cn].some(x => x > 0)) return; const b = Float64Array.from(a); for (let j = 0; j < K; j++) if (!cn[j]) { let l = j, r = j, dl = 0, dr = 0; do { l = (l - 1 + K) % K; dl++; } while (!cn[l]); do { r = (r + 1) % K; dr++; } while (!cn[r]); b[j] = (a[l] * dr + a[r] * dl) / (dl + dr); } a.set(b); }
function lowpass(a, H) { const K = a.length, out = new Float64Array(K), TAU = Math.PI * 2; for (let k = 0; k <= H; k++) { let cc = 0, ss = 0; for (let j = 0; j < K; j++) { const th = TAU * k * j / K; cc += a[j] * Math.cos(th); ss += a[j] * Math.sin(th); }
  cc *= (k === 0 ? 1 : 2) / K; ss *= 2 / K; for (let j = 0; j < K; j++) { const th = TAU * k * j / K; out[j] += cc * Math.cos(th) + (k === 0 ? 0 : ss * Math.sin(th)); } } return out; }
// drop the garment part's triangles (this garment's own panels, posed) whose three corners pass `test`
function hideIn(C, test, owner = null) { let dropped = 0; for (const q of C.parts) { if (q.group !== 'garment' || q.owner !== (owner || C.id)) continue; const n = q.X.length / 3, Xh = new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) Xh[i] = q.X[i] / C.scale;
    const Pp = skinPose(Xh, q.SI, q.SW, C.M, new Float64Array(n * 3), C.scale), hid = new Uint8Array(n); for (let v = 0; v < n; v++) hid[v] = test([Pp[v * 3], Pp[v * 3 + 1], Pp[v * 3 + 2]]) ? 1 : 0;
    const cut = T => { const o = []; for (let k = 0; k < T.length; k += 3) { if (hid[T[k]] && hid[T[k + 1]] && hid[T[k + 2]]) { dropped++; continue; } o.push(T[k], T[k + 1], T[k + 2]); } return Int32Array.from(o); };
    q.T = cut(q.T); if (q.Tfull) q.Tfull = cut(q.Tfull); } return dropped; }
function turnedHem(C, L, name, { depth = 0.022, run = null } = {}) {
  const ids = run || L.ids, closed = run ? false : L.closed, fr = frameIn(C, ids, closed, 2);
  const prof = [[0.006, 0.0005], [0.0012, 0.0009], [-0.0011, 0], [0.0012, -0.001], [depth, -0.0011], [depth + 0.001, -0.0004]];
  return C.add(sweep(fr.P, fr.N, fr.I, prof, closed), ids, name, 'hem');
}
// ---------------------------------------------------------------- uv helpers
const ccw = poly => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a < 0 ? poly.slice().reverse() : poly; };
const cent = X => { let s = [0, 0, 0]; const n = X.length / 3; for (let i = 0; i < n; i++) s = add(s, [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]]); return scl(s, 1 / n); };
function orientOutward(X, T, C, panel, poly) { // face the patch the way the cloth faces (its normal at the patch's centre)
  let u = 0, v = 0; for (const q of poly) { u += q[0] / poly.length; v += q[1] / poly.length; } const r = C.on(panel, u, v); if (!r) return; const ref = sub(r.p, scl(r.n, 0.02)); orientFrom(X, T, () => ref); }
function resample(poly, step, closed) { const out = [], n = poly.length, segs = closed ? n : n - 1; for (let i = 0; i < segs; i++) { const a = poly[i], b = poly[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.round(L / step)); for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); } if (!closed) out.push(poly[n - 1]); return out; }
function inset(poly, d) { const P = ccw(poly), n = P.length, out = []; for (let i = 0; i < n; i++) { const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], e1 = nrm2([b[0] - a[0], b[1] - a[1]]), e2 = nrm2([c[0] - b[0], c[1] - b[1]]), n1 = [-e1[1], e1[0]], n2 = [-e2[1], e2[0]], bis = nrm2([n1[0] + n2[0], n1[1] + n2[1]]), k = d / Math.max(0.3, bis[0] * n1[0] + bis[1] * n1[1]); out.push([b[0] + bis[0] * k, b[1] + bis[1] * k]); } return out; }
const nrm2 = a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
// a frame in a panel's uv: origin o, e1 (unit), e2 (unit, e1 turned +90 deg): local (x, y) -> uv
const frameUV = (o, e1) => { const e2 = [-e1[1], e1[0]]; return (x, y) => [o[0] + e1[0] * x + e2[0] * y, o[1] + e1[1] * x + e2[1] * y]; };
const dirUV = (a, b) => nrm2([b[0] - a[0], b[1] - a[1]]);
// a panel's u extent at height v (its outline), from the pattern's flat panel
function spanAt(C, panel, v) { const pn = C.panel(panel), U = pn.uv, nb = pn.boundary.length; let a = Infinity, b = -Infinity; for (let k = 0; k < nb; k++) { const i = pn.boundary[k], j = pn.boundary[(k + 1) % nb], y0 = U[i * 2 + 1], y1 = U[j * 2 + 1]; if ((y0 - v) * (y1 - v) > 0 || y0 === y1) continue; const x = U[i * 2] + (U[j * 2] - U[i * 2]) * (v - y0) / (y1 - y0); a = Math.min(a, x); b = Math.max(b, x); } return [a, b]; }
function vRange(C, panel) { const U = C.panel(panel).uv; let a = Infinity, b = -Infinity; for (let i = 1; i < U.length; i += 2) { a = Math.min(a, U[i]); b = Math.max(b, U[i]); } return [a, b]; }

// ---------------------------------------------------------------- the garments
const TRIMS = {
  // a knit tee: the rib neckband, the coverstitched hems of the body and the sleeves
  tee(C) { const r = {}, P = C.Gs.panels; const neck = topLoop(C); if (neck) { band(C, neck, 'tee.neckband', { H: 0.016, taper: 0.06, t: 0.0011, fabric: 'rib', color: C.color }); r.neck = neck.ids.length; }
    for (const L of C.Gs.loops) { if (L === neck || L.ids.length < 8) continue; const sl = L.ids.filter(v => P[v].has('sleeveL') || P[v].has('sleeveR')).length > L.ids.length / 2; turnedHem(C, L, sl ? 'tee.hem.sleeve' : 'tee.hem', { depth: sl ? 0.018 : 0.022 }); r[sl ? 'sleeveHems' : 'hem'] = (r[sl ? 'sleeveHems' : 'hem'] || 0) + 1; }
    return r; },
  scrubTop(C, o) { const r = TRIMS.tee(C, o); const side = o.sex === 'f' ? 1 : 1, v0 = C.tag('front', 'armhole')?.[1]; if (v0 != null) { const [a, b] = spanAt(C, 'front', v0 - 0.06), uc = (a + b) / 2 + side * (b - a) * 0.22, w = 0.12, hh = 0.13, top = v0 - 0.04;
      r.pocket = patch(C, 'front', [[uc - w / 2, top], [uc - w / 2, top - hh], [uc + w / 2, top - hh], [uc + w / 2, top]], 'scrub.pocket', { rows: [0.005] }); } return r; },
  // a crew sweatshirt: rib cuffs, hem band and neckband
  sweat(C) { const r = {}, P = C.Gs.panels, neck = topLoop(C); if (neck) { band(C, neck, 'sweat.neckband', { H: 0.022, taper: 0.08, t: 0.0014, fabric: 'rib', color: C.color }); r.neck = 1; }
    for (const L of C.Gs.loops) { if (L === neck || L.ids.length < 8) continue; const sd = L.ids.filter(v => P[v].has('sleeveL')).length > L.ids.length / 2 ? 'L' : L.ids.filter(v => P[v].has('sleeveR')).length > L.ids.length / 2 ? 'R' : null;
      if (sd) { const w = C.h.joint('wrist.' + sd), e = C.h.joint('lowerarm01.' + sd), d = [w.x - e.x, w.y - e.y, w.z - e.z]; r['cuff' + sd] = ribTube(C, L, 'sweat.cuff.' + sd, { a: d, H: 0.075, taper: 0.22, t: 0.0016, over: 0.014, harm: 2, K: 32, gap: 0.003, color: C.color }); }
      else r.hem = ribTube(C, L, 'sweat.hemband', { a: [0, -1, 0], H: 0.068, taper: 0.06, t: 0.0017, over: 0.016, harm: 4, K: 64, gap: 0.003, color: C.color }); }
    return r; },
  // five-pocket jeans: back pockets, the back yoke, front pocket mouths, the coin pocket, rivets, the fly's J stitching
  jeans(C, o) { return fivePocket(C, o, true); },
  chinos(C, o) { return fivePocket(C, o, false); },
  scrubPants(C) { return {}; },
  // a four-gore A-line skirt: the turned hem (the waistband is CLOTH4's ring)
  skirt(C) { const r = {}; let low = null, ly = Infinity; const big = C.Gs.loops.slice().sort((a, b) => b.ids.length - a.ids.length).slice(0, 2); for (const L of big) { let y = 0; for (const v of L.ids) y += C.Gs.X[v * 3 + 1]; y /= L.ids.length; if (y < ly) { ly = y; low = L; } }
    if (low) { turnedHem(C, low, 'skirt.hem', { depth: 0.035 }); r.hem = low.ids.length; } return r; },
  // a chore coat: patch pockets (two at the hip, one at the left chest), buttons down the button side, buttonholes opposite, hems
  jacket(C, o) { const r = {}, f = o.sex === 'f';
    for (const sd of ['L', 'R']) { const pn = 'front' + sd, hem = C.tag(pn, 'hem'), cfH = C.tag(pn, 'cfHem'), arm = C.tag(pn, 'armhole'), cfN = C.tag(pn, 'cfNeck'); if (!hem || !cfH || !arm || !cfN) continue;
      const sg = Math.sign(hem[0] - cfH[0]) || 1, vH = Math.max(hem[1], cfH[1]), vTop = vH + 0.25, [a, b] = spanAt(C, pn, vTop - 0.09), W = Math.abs(b - a), uc = cfH[0] + sg * W * 0.52, w = f ? 0.15 : 0.17, hh = f ? 0.16 : 0.18;
      r['hip' + sd] = patch(C, pn, [[uc - w / 2, vTop], [uc - w / 2, vTop - hh + 0.01], [uc - w / 2 + 0.01, vTop - hh], [uc + w / 2 - 0.01, vTop - hh], [uc + w / 2, vTop - hh + 0.01], [uc + w / 2, vTop]], 'jacket.pocket.' + sd, { rows: [0.004, 0.011] });
      if (sd === 'L') { const vc = arm[1] - 0.005, [a2, b2] = spanAt(C, pn, vc - 0.06), W2 = Math.abs(b2 - a2), u2 = cfH[0] + sg * W2 * 0.5, w2 = f ? 0.11 : 0.12, h2 = f ? 0.12 : 0.135;
        r.chest = patch(C, pn, [[u2 - w2 / 2, vc], [u2 - w2 / 2, vc - h2 + 0.01], [u2, vc - h2], [u2 + w2 / 2, vc - h2 + 0.01], [u2 + w2 / 2, vc]], 'jacket.pocket.chest', { rows: [0.004] }); }
      // buttons on the button side (men: the wearer's right front; women: the left), buttonholes on the other, 5 down the centre front
      const btnSide = f ? 'L' : 'R', top = cfN[1] - 0.035, bot = vH + 0.17, nB = 5;
      for (let k = 0; k < nB; k++) { const v = top - (top - bot) * k / (nB - 1), u = cfH[0] + sg * 0.015;
        if (sd === btnSide) button(C, pn, u, v, `jacket.button.${k}`, { r: 0.0085, color: '#3a2c22' });
        else edgeLine(C, pn, [[cfH[0] + sg * 0.008, v], [cfH[0] + sg * 0.03, v]], `jacket.buttonhole.${k}`, { prof: [[-0.0014, 0], [-0.0014, 0.0005], [0.0014, 0.0005], [0.0014, 0]], lift: 0.0006, color: shade(C.color, 0.55), fabric: 'teeJersey', construction: 'stitch' }); } }
    // hems: the sleeve ends and the back's hem (the fronts' edges are K3's faced edges)
    const P = C.Gs.panels; for (const L of C.Gs.loops) { if (L.ids.length < 8) continue; const slv = L.ids.filter(v => P[v].has('sleeveL') || P[v].has('sleeveR')).length > L.ids.length / 2;
      if (slv) { turnedHem(C, L, 'jacket.hem.sleeve', { depth: 0.03 }); r.sleeveHems = (r.sleeveHems || 0) + 1; continue; }
      const runs = splitRuns(L, v => P[v].has('back') && !P[v].has('frontL') && !P[v].has('frontR') && C.Gs.X[v * 3 + 1] < C.h.joint('spine02').y * C.scale);
      for (const run of runs) if (run.length > 6) { turnedHem(C, L, 'jacket.hem.back', { depth: 0.03, run }); r.backHem = run.length; } }
    return r; },
};
function topLoop(C) { let best = null, by = -Infinity; for (const L of C.Gs.loops) { if (L.ids.length < 10) continue; let y = 0; for (const v of L.ids) y += C.Gs.X[v * 3 + 1]; y /= L.ids.length; if (y > by) { by = y; best = L; } } return best; }
function splitRuns(L, keep) { const ids = L.ids, m = ids.length, inS = ids.map(keep); if (inS.every(Boolean)) return [ids.slice()]; let s = inS.findIndex(x => !x); const out = []; let cur = []; for (let k = 1; k <= m; k++) { const i = (s + k) % m; if (inS[i]) cur.push(ids[i]); else if (cur.length) { out.push(cur); cur = []; } } if (cur.length) out.push(cur); return out; }

// jeans (five pockets, gold stitching, rivets) or chinos (slant pockets, back welts, tone stitching)
function fivePocket(C, o, jeans) {
  const r = {}, f = o.sex === 'f';
  for (const sd of ['L', 'R']) {
    // ---- the back: the yoke (jeans), the patch pockets (jeans) or the welts (chinos)
    const bk = 'back' + sd, wO = C.tag(bk, 'styleWaistOut'), wI = C.tag(bk, 'styleWaistIn');
    if (wO && wI) { const ex = dirUV(wO, wI), Lw = Math.hypot(wI[0] - wO[0], wI[1] - wO[1]), dn = [ex[1], -ex[0]], toDown = (dn[1] < 0 ? dn : [-dn[0], -dn[1]]), F = (x, y) => [wO[0] + ex[0] * x + toDown[0] * y, wO[1] + ex[1] * x + toDown[1] * y];
      if (jeans) { // the yoke seam: 4 cm under the waist at the side seam to 7.5 cm at the centre back
        const yk = []; for (let k = 0; k <= 10; k++) { const x = Lw * k / 10; yk.push(F(x, 0.04 + 0.035 * k / 10)); }
        stitchLine(C, bk, yk, `jeans.yoke.${sd}.a`); stitchLine(C, bk, yk.map(q => [q[0] + toDown[0] * 0.006, q[1] + toDown[1] * 0.006]), `jeans.yoke.${sd}.b`);
        const w = f ? 0.125 : 0.14, hs = f ? 0.13 : 0.145, cx = Lw * 0.52, top = 0.082, poly = [F(cx - w / 2, top), F(cx - w / 2 + 0.006, top + hs), F(cx, top + hs + 0.018), F(cx + w / 2 - 0.006, top + hs), F(cx + w / 2, top)];
        r['back' + sd] = patch(C, bk, poly, `jeans.pocket.${sd}`, { rows: [0.003, 0.009], color: C.color });
        // the arcuate: two shallow arcs stitched across the pocket
        for (const [k, y0] of [[0, 0.055], [1, 0.064]]) { const arc = []; for (let i = 0; i <= 12; i++) { const s = i / 12, x = cx - w / 2 + 0.014 + (w - 0.028) * s; arc.push(F(x, top + y0 + 0.025 * Math.sin(Math.PI * s * 2) * (s < 0.5 ? 1 : 1) * 0.6)); } stitchLine(C, bk, arc, `jeans.arcuate.${sd}.${k}`); } }
      else { const w = f ? 0.12 : 0.135, cx = Lw * 0.5, y = 0.075, ln = [F(cx - w / 2, y), F(cx + w / 2, y)];
        edgeLine(C, bk, ln, `chinos.welt.${sd}`, { prof: [[-0.006, 0], [-0.0055, 0.0016], [0, 0.0019], [0.0055, 0.0016], [0.006, 0]], lift: 0.0004 }); edgeLine(C, bk, ln, `chinos.welt.${sd}.lip`, { prof: [[-0.0004, 0], [-0.0004, 0.0021], [0.0004, 0.0021], [0.0004, 0]], lift: 0.0004, color: shade(C.color, 0.45) });
        if (sd === 'R') button(C, bk, ...F(cx, y + 0.014), 'chinos.welt.button', { r: 0.0055, color: shade(C.color, 0.6) }); r['welt' + sd] = 1; } }
    // ---- the front: the pocket mouth (a jeans scoop / a chinos slant), its stitching, rivets; the coin pocket (jeans, wearer's right)
    const fr = 'front' + sd, fO = C.tag(fr, 'styleWaistOut'), fI = C.tag(fr, 'styleWaistIn'), fl = C.tag(fr, 'floorOut');
    if (fO && fI && fl) { const ex = dirUV(fO, fI), ey = dirUV(fO, fl), A = jeans ? 0.105 : 0.045, Bd = jeans ? 0.085 : 0.16, S0 = [fO[0] + ex[0] * A, fO[1] + ex[1] * A], E0 = [fO[0] + ey[0] * Bd, fO[1] + ey[1] * Bd];
      const mouth = []; for (let i = 0; i <= 14; i++) { const th = i / 14 * Math.PI / 2; mouth.push(jeans ? [fO[0] + ex[0] * A * (1 - Math.sin(th)) * 1 + ey[0] * Bd * (1 - Math.cos(th)) + (ex[0] * A + ey[0] * Bd) * 0 , fO[1] + ex[1] * A * (1 - Math.sin(th)) + ey[1] * Bd * (1 - Math.cos(th))] : [S0[0] + (E0[0] - S0[0]) * i / 14, S0[1] + (E0[1] - S0[1]) * i / 14]); }
      // (the jeans' mouth bows toward the waist / side corner: a quarter ellipse about the corner opposite)
      if (jeans) for (let i = 0; i <= 14; i++) { const th = i / 14 * Math.PI / 2, cC = [fO[0] + ex[0] * A + ey[0] * Bd, fO[1] + ex[1] * A + ey[1] * Bd]; mouth[i] = [cC[0] - ey[0] * Bd * Math.cos(th) - ex[0] * A * Math.sin(th), cC[1] - ey[1] * Bd * Math.cos(th) - ex[1] * A * Math.sin(th)]; }
      edgeLine(C, fr, mouth, `${jeans ? 'jeans' : 'chinos'}.mouth.${sd}`, { prof: rimProfile(0.0015), lift: 0.0007 });
      const off = (pl, d) => pl.map((q, i) => { const a = pl[Math.max(0, i - 1)], b = pl[Math.min(pl.length - 1, i + 1)], t = dirUV(a, b), nn = [-t[1], t[0]], s = (nn[0] * (fI[0] - fO[0]) + nn[1] * (fI[1] - fO[1])) > 0 ? 1 : -1; return [q[0] + nn[0] * d * s, q[1] + nn[1] * d * s]; });
      stitchLine(C, fr, off(mouth, 0.004), `${jeans ? 'jeans' : 'chinos'}.mouth.${sd}.st`); if (jeans) stitchLine(C, fr, off(mouth, 0.01), `jeans.mouth.${sd}.st2`);
      if (jeans) { rivet(C, fr, ...off([mouth[0], mouth[1]], 0.003)[0].map((x, k) => x + ey[k] * 0.045), `jeans.rivet.top.${sd}`); rivet(C, fr, ...off([mouth[13], mouth[14]], 0.003)[1].map((x, k) => x + ex[k] * 0.004), `jeans.rivet.side.${sd}`);
        if (sd === 'R') { const cx = 0.055, F2 = (x, y) => [fO[0] + ex[0] * x + ey[0] * y, fO[1] + ex[1] * x + ey[1] * y], cw = 0.07, ch = 0.075, t0 = 0.045;
          r.coin = patch(C, fr, [F2(cx - cw / 2, t0), F2(cx - cw / 2, t0 + ch), F2(cx + cw / 2, t0 + ch), F2(cx + cw / 2, t0)], 'jeans.coin', { rows: [0.003] }); } }
      r['front' + sd] = 1; }
  }
  // the fly: the J stitched beside the closure (men and women: a fly front), double rows in jeans
  const cl = (C.pat.closures || []).find(c => c.name === 'fly'); if (cl) { const pn = cl.a.panel, uvs = Array.from(cl.a.verts, v => [C.panel(pn).uv[v * 2], C.panel(pn).uv[v * 2 + 1]]).sort((a, b) => b[1] - a[1]);
    const fI = C.tag(pn, 'styleWaistIn'), fO = C.tag(pn, 'styleWaistOut'), ex = fI && fO ? dirUV(fI, fO) : [1, 0], J = uvs.map((q, i) => { const s = i / (uvs.length - 1), o2 = 0.034 * (1 - Math.max(0, (s - 0.75) / 0.25) * 0.85); return [q[0] + ex[0] * o2, q[1] + ex[1] * o2]; });
    stitchLine(C, pn, J, 'fly.J'); if (jeans) stitchLine(C, pn, J.map((q, i) => { const s = i / (J.length - 1), o2 = 0.006 * (1 - Math.max(0, (s - 0.75) / 0.25)); return [q[0] - ex[0] * o2, q[1] - ex[1] * o2]; }), 'fly.J2'); r.fly = J.length; }
  return r;
}
