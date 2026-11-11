// HAIR / grow: roots on the skin, strands grown from them, and the strands turned into skinned card geometry (HUMAN c8 lane D).
//
// A strand is grown the way a groomer combs: from a root on the real mesh (field.js) it leaves the skin at a lift angle, then each
// step blends its own direction (stiffness), the style's comb direction at the point it has reached (a flow field over the scalp: back,
// down, a side part, the crown whorl, gathered to a tie, out), and gravity weighted by the length already hanging (a cantilever
// sags by its own weight; short hair stands, long hair falls). Every step is pushed out of the skull, the neck and the shoulders to
// the layer's volume offset (inner layers lie on the scalp, outer ones stand off it, so the hair has thickness), and into a hat's
// inner shell where one is worn. Waves and curls are then laid on the centreline (a planar wave or a helix whose phase is shared by
// the clump, so curls clump), and the strand is cut where a style says (a bob's line, an afro's rounded envelope).
//
// Styles may instead give GUIDES: a few polylines in head units (JSON); a clump's shape is the inverse-distance blend of its three
// nearest guides, each offset to the clump's root (the interpolation every groom tool does, e.g. Ward, Bertails, Kim, Marschner,
// Cani and Lin, "A survey on hair modeling", IEEE TVCG 13(2) 2007), with a `pin` that pulls the offsets to zero along the strand so
// gathered hair converges at a tie.
//
// A clump becomes a RIBBON (a tapered card along the centreline, its width lying in the hair surface, rolled for the outer layer so
// the silhouette always has cards facing the eye) or a TUBE (locs, plait sub-strands, rolls). Each vertex carries: the bind position,
// a bent normal (the hair volume's outward normal more than the card's: cards shade as a volume, not as planks), the strand tangent
// (aHairT, for the Kajiya-Kay lobes), the atlas uv, aHair = (along 0 root .. 1 tip, depth 0 outer .. 1 inner, card random, grey
// bias), the root's skin weights (blended to the neck and the upper spine where long hair hangs below the jaw) and, for face cards,
// the root's expression morph deltas.
import * as THREE from 'three';
import { sstep, mulberry, REG } from './field.js';
import { tileU, PERIODIC4, TILE, TILE4 } from './atlas.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const G = V(0, -1, 0);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const proj = (v, n) => { const r = v.clone().addScaledVector(n, -v.dot(n)); const l = r.length(); return l > 1e-6 ? r.divideScalar(l) : null; };

// ---------------------------------------------------------------- the scalp's cells (cached on the field)
export function scalpCells(F) {
  if (F._cells) return F._cells;
  const { N, R, TRI, EAR, C } = F, d = [0, 0, 0], list = [];
  const AH = F.h.aHero, IDX = F.h.body.geometry.index.array;
  for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ci = (f * N + j) * N + i, t = TRI[ci]; if (t < 0 || EAR[ci]) continue;
    if (AH[IDX[t] * 4] !== REG.head) continue;
    const u = (i + 0.5) / N * 2 - 1, v = (j + 0.5) / N * 2 - 1; F.faceDir(f, u, v, d);
    const r = R[ci], p = V(C.x + d[0] * r, C.y + d[1] * r, C.z + d[2] * r); if (p.y < F.eyeY - 0.11) continue;
    const sp = F.surf(t, F.BB[ci * 2], F.BB[ci * 2 + 1]), cosA = Math.max(0.25, Math.abs(sp.n.x * d[0] + sp.n.y * d[1] + sp.n.z * d[2]));
    const area = (2 / N) * (2 / N) / Math.pow(1 + u * u + v * v, 1.5) * r * r / cosA;
    list.push({ ci, f, u, v, p: sp.p, n: sp.n, area, ph: Math.atan2(sp.p.x - C.x, sp.p.z - C.z) });
  }
  return (F._cells = list);
}

// ---------------------------------------------------------------- the hairline and density over the scalp
// H (bind metres, heights above the eye centre; style JSON gives cm): front (trichion), temple (the temporal recess above the
// front line), side (the sideburn's lower end), nape, recede (Norwood: the whole front line up), crown (vertex thinning 0..1),
// thin (diffuse thinning 0..1; Ludwig's pattern for women keeps the front line), soft (the edge's ramp). The line runs round the
// ear measured from the mesh (field.js EAR): front -> temple recess -> down the sideburn -> over the ear -> down to the nape.
export function hairlineFn(F, H = {}) {
  const fem = F.sex === 'f', e0 = F.earF, e1 = F.earB;
  const front = (H.front ?? (fem ? 6.0 : 6.4)) / 100 + (H.recede ?? 0) / 100, temple = (H.temple ?? (fem ? 0.4 : 1.0)) / 100 + 0.6 * (H.recede ?? 0) / 100;
  const side = (H.side ?? (fem ? 1.6 : -1.0)) / 100, overEar = F.earTop - F.eyeY + 0.006, nape = (H.nape ?? -7.4) / 100, soft = (H.soft ?? 0.4) / 100;
  const K = [[0, front], [0.32, front + 0.002], [0.7, front + temple], [0.95, front - 0.016], [Math.max(1.0, e0 - 0.22), side + 0.008], [e0 - 0.08, side], [e0 - 0.02, side],
    [e0 + 0.05, overEar], [e1 - 0.05, overEar], [e1 + 0.32, nape + 0.035], [e1 + 0.65, nape], [Math.PI + 0.01, nape]];
  // a C1 monotone cubic through the knots (Fritsch and Carlson 1980): an eased step per segment has zero slope at every knot, and
  // the line flattened into a shelf at each one (the temple 'notch' of the first renders)
  const M = K.map((k, i) => { const a = K[Math.max(0, i - 1)], b = K[Math.min(K.length - 1, i + 1)];
    const s0 = i > 0 ? (k[1] - a[1]) / Math.max(1e-6, k[0] - a[0]) : null, s1 = i < K.length - 1 ? (b[1] - k[1]) / Math.max(1e-6, b[0] - k[0]) : null;
    if (s0 == null || s1 == null) return 0; if (s0 * s1 <= 0) return 0; return 2 / (1 / s0 + 1 / s1); });
  const line = aph => { for (let k = 1; k < K.length; k++) if (aph <= K[k][0]) { const [a0, v0] = K[k - 1], [a1, v1] = K[k], dx = a1 - a0 + 1e-9, t = Math.min(1, Math.max(0, (aph - a0) / dx)), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * dx * M[k - 1] + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * dx * M[k]; } return nape; };
  const W = F.fromHU(H.whorl || [0.05, 0.62, -0.55]);
  // the density away from the line: crown (vertex) thinning, diffuse thinning, a band (a horseshoe fringe)
  const extra = p => { const ys = p.y - F.eyeY; let d = 1;
    if (H.crown) d *= 1 - H.crown * sstep(0.065, 0.02, p.distanceTo(W));
    if (H.thin) d *= 1 - H.thin * sstep(0.02, 0.07, ys) * (fem ? sstep(0.02, 0.09, ys) : 1);
    if (H.band) d *= sstep(H.band[0] / 100 - soft, H.band[0] / 100 + soft, ys) * sstep(H.band[1] / 100 + soft, H.band[1] / 100 - soft, ys);
    return d; };
  const fn = (p, ph) => { const aph = Math.abs(ph ?? Math.atan2(p.x - F.C.x, p.z - F.C.z)), L = line(aph); return sstep(L - soft, L + soft, p.y - F.eyeY) * extra(p); };
  // the distance (m, over the scalp) from p inside the line to it: the height above the line divided by the line's own slope term, so
  // where the line runs steeply down the temple a root just behind it counts as at the edge
  fn.dist = (p, ph) => { const aph = Math.abs(ph ?? Math.atan2(p.x - F.C.x, p.z - F.C.z)), e = p.y - F.eyeY - line(aph), sl = (line(aph + 0.01) - line(Math.max(0, aph - 0.01))) / (aph + 0.01 - Math.max(0, aph - 0.01)), R = Math.max(0.03, Math.hypot(p.x - F.C.x, p.z - F.C.z));
    return e / Math.sqrt(1 + (sl / R) ** 2); };
  fn.knots = K.map((k, i) => [k[0], k[1], M[i]]).concat(Array(Math.max(0, 12 - K.length)).fill([K.at(-1)[0] + 1, K.at(-1)[1], 0])).slice(0, 12); fn.soft = soft; fn.extra = extra; fn.line = line;
  return fn;
}

// ---------------------------------------------------------------- roots: area- and density-weighted, then thinned to blue noise
export function sampleRoots(F, dens, count, rnd, { minSep = null, mask = null } = {}) {
  const cells = scalpCells(F), w = new Float64Array(cells.length); let tot = 0, area = 0;
  for (let k = 0; k < cells.length; k++) { const c = cells[k]; let d = dens(c.p, c.ph); if (mask) d *= mask(c.p, c.ph, c.n); w[k] = c.area * d; tot += w[k]; area += c.area * Math.min(1, d); }
  if (tot <= 0 || count <= 0) return [];
  const cdf = new Float64Array(cells.length); let acc = 0; for (let k = 0; k < cells.length; k++) { acc += w[k]; cdf[k] = acc / tot; }
  const sep = minSep ?? 0.62 * Math.sqrt(area / count), cell = sep, grid = new Map(), out = [], dd = [0, 0, 0];
  const key = p => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
  const tries = count * 3;
  for (let it = 0; it < tries && out.length < count; it++) {
    const r = (it + rnd()) / tries, x = rnd();
    let lo = 0, hi = cells.length - 1; const q = (r * 0.5 + x * 0.5); while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < q) lo = m + 1; else hi = m; }
    const c = cells[lo], N = F.N;
    F.faceDir(c.f, c.u + (rnd() - 0.5) * 2 / N, c.v + (rnd() - 0.5) * 2 / N, dd);
    const hit = F.cast(dd[0], dd[1], dd[2]); if (!hit) continue;
    const sp = F.surf(hit.tri, hit.b1, hit.b2);
    if (F.h.aHero[sp.verts[0] * 4] !== REG.head) continue;
    const k0 = Math.floor(sp.p.x / cell), k1 = Math.floor(sp.p.y / cell), k2 = Math.floor(sp.p.z / cell); let ok = true;
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (let e = -1; e <= 1 && ok; e++) { const L = grid.get(`${k0 + a},${k1 + b},${k2 + e}`); if (L) for (const o of L) if (o.p.distanceToSquared(sp.p) < sep * sep) { ok = false; break; } }
    if (!ok) continue;
    sp.ph = Math.atan2(sp.p.x - F.C.x, sp.p.z - F.C.z); sp.dens = dens(sp.p, sp.ph);
    const kk = key(sp.p); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(sp); out.push(sp);
  }
  return out;
}

// ---------------------------------------------------------------- comb directions (unit, tangent to the head at p)
// flow: { type: 'back' | 'down' | 'whorl' | 'part' | 'gather' | 'up' | 'out' | 'forward' | 'side', part (deg, + = the person's left),
// to (head units), swirl, noise }
export function flowFn(F, flow = {}) {
  const C = F.C, W = F.fromHU(flow.whorl || [0.05, 0.62, -0.55]), T = flow.to ? F.fromHU(flow.to) : null, pa = (flow.part ?? 0) * Math.PI / 180;
  const m = V(Math.cos(pa), 0, -Math.sin(pa));            // the part plane's normal (the part runs front to back at azimuth pa)
  const type = flow.type || 'down';
  return (p, n) => {
    let v;
    const awayW = p.clone().sub(W); const dW = awayW.length(); awayW.normalize();
    if (type === 'back') v = V(0, -0.45, -1);
    else if (type === 'forward') v = V(0, -0.35, 1);
    else if (type === 'up') v = V(0, 1, -0.25);
    else if (type === 'out') v = n.clone();
    else if (type === 'side') v = V(flow.dir ?? 1, -0.6, -0.2);
    else if (type === 'gather') { // toward the tie; where the tie is behind the head (the front and the top: T - p runs into the skull and
      // its tangent part is ill-conditioned, so the front hair fanned sideways), the comb goes straight back over the top instead
      const dT = T.clone().sub(C).normalize(), w = sstep(-0.15, -0.7, n.dot(dT)), g = T.clone().sub(p).normalize();
      v = g.multiplyScalar(1 - w).addScaledVector(V(0, 1, -0.35).normalize(), w); }
    else if (type === 'part') { const s = Math.sign(p.clone().sub(C).dot(m)) || 1; const front = sstep(-0.2, 0.6, (p.z - C.z) / F.rz);
      // away from the part and back over the head (a part combs ACROSS and back: the first version's -y at the front combed the
      // front hair down over the forehead)
      v = m.clone().multiplyScalar(s * (0.85 + 0.3 * front)).add(V(0, -0.45 * (1 - front), -0.35 - 0.45 * front)); }
    else if (type === 'crop') { // a clipper crop: out from the crown's whorl on top, lying down and back along the sides and the temples
      const sd = sstep(0.5, 0.15, n.y); v = awayW.clone().multiplyScalar(1 - sd).addScaledVector(V(0, -0.55, -1).normalize(), sd); }
    else if (type === 'whorl') { v = awayW.clone().add(awayW.clone().cross(n).multiplyScalar(flow.swirl ?? 0.35)); }
    else v = V(0, -1, 0);
    if (type === 'down' || type === 'back' || type === 'part') v.addScaledVector(awayW, 0.9 * sstep(0.05, 0.0, dW) + 0.3 * sstep(0.85, 1, n.y));   // the crown's whorl
    if (type === 'whorl' || type === 'down') v.add(V(0, 0, 0.0));
    return proj(v, n) || proj(V(0, -1, -0.2), n) || V(0, -1, 0);
  };
}

// ---------------------------------------------------------------- a strand
// P (metres): lift (0 flat .. 1 standing), stiff, comb, grav, jit, off0/off1 (volume offset at the root and from 10 cm on), seg/segLen,
// hatMargin, cutY (bind y below which the strand is cut), env (an ellipsoid in head units it is cut at), gather {to, r}, rootOff
export function growStrand(F, sp, L, P, rnd, flow) {
  const segs = Math.max(2, Math.min(P.maxSeg ?? 26, Math.ceil(L / (P.segLen ?? 0.011)))), ds = L / segs;
  const p = sp.p.clone().addScaledVector(sp.n, P.rootOff ?? 0.0006), pts = [p.clone()];
  let d = flow(p, sp.n).multiplyScalar(1 - (P.lift ?? 0.2)).addScaledVector(sp.n, P.lift ?? 0.2).normalize();
  const jit = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(2 * (P.jit ?? 0.12));
  const off0 = P.off0 ?? 0.0015, off1 = P.off1 ?? 0.006, stiff = P.stiff ?? 1, comb = P.comb ?? 0.6, grav = P.grav ?? 0.5, cling = P.cling ?? 0;
  const T = P.gather ? F.fromHU(P.gather.to) : null, Tr = P.gather ? (P.gather.r ?? 1.2) / 100 : 0;
  const env = P.env ? { a: P.env, c: F.C } : null;
  let hidden = 0, cut = false, pressed = 0;
  const prev = V(), out = V();
  for (let k = 1; k <= segs; k++) {
    const hang = L * k / segs;
    out.copy(p).sub(F.C).normalize();
    const fl = flow(p, out);
    d.multiplyScalar(stiff).addScaledVector(fl, comb * (1 - 0.5 * k / segs)).addScaledVector(G, grav * hang / 0.1).add(jit).normalize();
    prev.copy(p); p.addScaledVector(d, ds);
    const off = off0 + (off1 - off0) * Math.min(1, hang / 0.1);
    // cling: combed hair lies on the hair below it; a straight step off a convex head would leave the surface by ds^2 / 2R each
    // step and the strand would fly off on its tangent. Pull the point back toward the layer's offset surface (1 = sleek, 0 = free)
    if (cling > 0 && p.y > F.chinY) { const dx = p.x - F.C.x, dy = p.y - F.C.y, dz = p.z - F.C.z, l = Math.hypot(dx, dy, dz), rs = F.rAt(dx / l, dy / l, dz / l);
      if (rs > 0 && l > rs + off) { const l2 = rs + off + (l - rs - off) * (1 - cling), k = l2 / l; p.set(F.C.x + dx * k, F.C.y + dy * k, F.C.z + dz * k); } }
    F.push(p, off);
    let under = false;
    if (F.hat && P.hat !== false) { if (F.hat.clamp(p, P.hatMargin ?? 0.0025)) { F.push(p, 0.0008); pressed++; } under = p.y >= F.hat.rimAt(Math.atan2(p.x - F.C.x, p.z - F.C.z)) - 0.002; }
    if (under) hidden++;
    if (P.cutY != null && p.y < P.cutY) { const t = (prev.y - P.cutY) / Math.max(1e-6, prev.y - p.y); p.lerpVectors(prev, p, clamp(t)); cut = true; }
    if (env) { const q = F.toHU(p), r = Math.hypot(q[0] / env.a[0], (q[1] - (env.a[3] ?? 0)) / env.a[1], q[2] / env.a[2]); if (r > 1) { const qp = F.toHU(prev), rp = Math.hypot(qp[0] / env.a[0], (qp[1] - (env.a[3] ?? 0)) / env.a[1], qp[2] / env.a[2]); p.lerpVectors(prev, p, clamp((1 - rp) / Math.max(1e-6, r - rp))); cut = true; } }
    if (T && p.distanceTo(T) < Tr) cut = true;
    const dd = p.clone().sub(prev); if (dd.lengthSq() > 1e-12) d.copy(dd.normalize());
    pts.push(p.clone());
    if (cut) break;
  }
  return { pts, hidden: F.hat ? hidden >= pts.length - 1 && pts[0].y >= F.hat.rimAt(sp.ph ?? 0) - 0.002 : false, cut, pressed };
}

// a clump from guides: the blend of its nearest guides, offset to its root, pulled together by `pin` along the strand
export function guideStrand(F, sp, guides, P, rnd) {
  const K = Math.min(3, guides.length), near = guides.map(g => [g, g.root.distanceToSquared(sp.p)]).sort((a, b) => a[1] - b[1]).slice(0, K);
  const ws = near.map(([, d2]) => 1 / (d2 + 1e-6)), wsum = ws.reduce((a, b) => a + b, 0);
  const n = Math.max(...near.map(([g]) => g.pts.length)), pts = [];
  const pin = P.pin ?? 0;
  for (let k = 0; k < n; k++) { const t = k / (n - 1), acc = V();
    near.forEach(([g], i) => { const q = resample(g.pts, t), offK = 1 - pin * sstep(0.1, 0.9, t); acc.addScaledVector(q.add(sp.p.clone().sub(g.root).multiplyScalar(offK)), ws[i] / wsum); });
    pts.push(acc); }
  // collision and the hat, as for grown strands (volume offset from the layer)
  const off0 = P.off0 ?? 0.0015, off1 = P.off1 ?? 0.006; let hidden = 0, L = 0;
  for (let k = 1; k < pts.length; k++) { L += pts[k].distanceTo(pts[k - 1]); F.push(pts[k], off0 + (off1 - off0) * Math.min(1, L / 0.1));
    if (F.hat && P.hat !== false) { if (F.hat.clamp(pts[k], P.hatMargin ?? 0.0025)) F.push(pts[k], 0.0008); if (pts[k].y >= F.hat.rimAt(Math.atan2(pts[k].x - F.C.x, pts[k].z - F.C.z)) - 0.002) hidden++; } }
  pts[0].copy(sp.p).addScaledVector(sp.n, 0.0006);
  return { pts, hidden: F.hat ? hidden >= pts.length - 1 : false };
}
function resample(pts, t) { const L = [0]; for (let k = 1; k < pts.length; k++) L.push(L[k - 1] + pts[k].distanceTo(pts[k - 1])); const s = t * L.at(-1); let k = 1; while (k < pts.length - 1 && L[k] < s) k++; const a = (s - L[k - 1]) / Math.max(1e-9, L[k] - L[k - 1]); return pts[k - 1].clone().lerp(pts[k], clamp(a)); }
export function arcLen(pts) { let L = 0; for (let k = 1; k < pts.length; k++) L += pts[k].distanceTo(pts[k - 1]); return L; }
export function resamplePts(pts, n) { const out = []; for (let k = 0; k < n; k++) out.push(resample(pts, k / (n - 1))); return out; }

// waves and curls on a centreline: a planar wave in the hair surface ('wave') or a helix ('curl'); amplitude A, period lam (m), phase ph;
// the amplitude ramps up over the first 1.5 cm (hair leaves the follicle straight) and the strand is pushed out again after
export function curlPts(F, pts, { A = 0, lam = 0.03, ph = 0, kind = 'wave', ramp = 0.015, off = 0.0012, axis = null } = {}) {
  if (!(A > 0)) return pts;
  const out = [pts[0].clone()]; let s = 0;
  for (let k = 1; k < pts.length; k++) { s += pts[k].distanceTo(pts[k - 1]);
    const d = (k < pts.length - 1 ? pts[k + 1] : pts[k]).clone().sub(pts[k - 1]).normalize(), o = (axis ? pts[k].clone().sub(axis(pts[k])) : pts[k].clone().sub(F.C)).normalize();
    const side = d.clone().cross(o).normalize(), up = side.clone().cross(d).normalize(), a = A * sstep(0, ramp, s), th = ph + s / lam * Math.PI * 2;
    const q = pts[k].clone().addScaledVector(side, a * Math.sin(th)); if (kind === 'curl') q.addScaledVector(up, a * Math.cos(th));
    out.push(F.push(q, off)); }
  return out;
}

// ---------------------------------------------------------------- skin weights along a strand
// the root's weights; where the strand hangs below the jaw they blend into the neck, and below the neck's base into the upper spine
export function skinBlend(F, sp, p) {
  const I = F.h.idx, yJ = F.chinY + 0.01, yN = F.nk.y + 0.01;
  const a = sstep(yJ, yN, p.y), b = sstep(yN, yN - 0.08, p.y);
  if (a <= 0) return [sp.si, sp.sw];
  const acc = new Map(); sp.si.forEach((s, k) => { if (sp.sw[k] > 0) acc.set(s, sp.sw[k] * (1 - a)); });
  acc.set(I.neck02, (acc.get(I.neck02) || 0) + a * (1 - b)); acc.set(I.spine01, (acc.get(I.spine01) || 0) + a * b);
  const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4), s = top.reduce((q, e) => q + e[1], 0);
  const si = [0, 0, 0, 0], sw = [0, 0, 0, 0]; top.forEach((e, k) => { si[k] = e[0]; sw[k] = e[1] / s; }); return [si, sw];
}

// ---------------------------------------------------------------- geometry
export class CardBuilder {
  constructor({ morphs = 0 } = {}) { this.P = []; this.N = []; this.UV = []; this.T = []; this.A = []; this.SI = []; this.SW = []; this.IX = []; this.M = morphs ? Array.from({ length: morphs }, () => []) : null; this.cards = 0; this.tubes = 0; }
  get count() { return this.P.length / 3; }
  _v(p, n, u, v, t, a, si, sw, md) { this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.UV.push(u, v); this.T.push(t.x, t.y, t.z); this.A.push(...a); this.SI.push(...si); this.SW.push(...sw);
    if (this.M) for (let i = 0; i < this.M.length; i++) { const d = md ? md[i] : null; this.M[i].push(d ? d[0] : 0, d ? d[1] : 0, d ? d[2] : 0); } }
  // a ribbon: pts (centreline), opts { tile, ua, ub (sub-range of the tile), w0, w1 (width root/tip, m), roll (rad, about the strand), depth,
  // rand, grey, out(p) -> outward volume normal, skin(p) -> [si, sw], morph (deltas, constant on the card), vScale }
  ribbon(pts, o) {
    const n = pts.length; if (n < 2) return;
    const [u0, u1] = tileU(o.tile || 'straight', o.ua ?? 0, o.ub ?? 1), base = this.count, L = arcLen(pts); let s = 0;
    const cr = Math.cos(o.roll || 0), sr = Math.sin(o.roll || 0);
    for (let k = 0; k < n; k++) {
      if (k) s += pts[k].distanceTo(pts[k - 1]);
      const t = s / Math.max(L, 1e-6), d = (k < n - 1 ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1])).normalize();
      const out = o.out ? o.out(pts[k]) : pts[k].clone().sub(o.C).normalize();
      // (HAIR3, opt-in o.sides: the width direction per point, from a smooth guide: along a helix d swings and a card's width flipped
      // with it, so curls read as flakes)
      let side = o.sides ? o.sides[k].clone() : d.clone().cross(out); if (side.lengthSq() < 1e-10) side = d.clone().cross(V(0, 1, 0)); side.normalize();
      const up = d.clone().cross(side);                                  // the card's own normal (lying in the hair surface: ~ out)
      const sd = side.clone().multiplyScalar(cr).addScaledVector(up, sr), cn = d.clone().cross(sd).normalize(); if (cn.dot(out) < 0) cn.negate();
      const bn = out.clone().multiplyScalar(o.bend ?? 0.75).addScaledVector(cn, 1 - (o.bend ?? 0.75)).normalize();
      const w = ((o.w0 ?? 0.012) + ((o.w1 ?? 0.004) - (o.w0 ?? 0.012)) * Math.pow(t, o.taper ?? 1.1)) / 2;
      const [si, sw] = o.skin ? o.skin(pts[k]) : [[0, 0, 0, 0], [1, 0, 0, 0]], v = o.vScale ? s / o.vScale : t;
      const a = [t, o.depth ?? 0, o.rand ?? 0, o.grey ?? 0];
      this._v(pts[k].clone().addScaledVector(sd, -w), bn, u0, v, d, a, si, sw, o.morph);
      this._v(pts[k].clone().addScaledVector(sd, w), bn, u1, v, d, a, si, sw, o.morph);
      if (k) { const i = base + 2 * (k - 1); this.IX.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    this.cards++;
  }
  // a tube: pts, radius r(t) or number, sides; tangent 'along' (locs, plait strands) or 'around' (a roll: the hair wraps round it); uv
  // u round the tube (the tile once), v along in metres / vScale (repeats; shade.js wraps it)
  tube(pts, o) {
    const n = pts.length; if (n < 2) return;
    const S = o.sides ?? 8, [u0, u1] = tileU(o.tile || 'plait', 0, 1), base = this.count, L = arcLen(pts); let s = 0;
    let prevN = null;
    for (let k = 0; k < n; k++) {
      if (k) s += pts[k].distanceTo(pts[k - 1]);
      const t = s / Math.max(L, 1e-6), d = (k < n - 1 ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1])).normalize();
      // parallel transport of the ring's frame
      let nx = prevN ? prevN.clone().addScaledVector(d, -prevN.dot(d)) : (Math.abs(d.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).cross(d);
      if (nx.lengthSq() < 1e-10) nx = V(1, 0, 0).cross(d); nx.normalize(); prevN = nx; const ny = d.clone().cross(nx);
      const r = typeof o.r === 'function' ? o.r(t, s) : o.r, [si, sw] = o.skin ? o.skin(pts[k]) : [[0, 0, 0, 0], [1, 0, 0, 0]];
      const out = o.out ? o.out(pts[k]) : null;
      for (let j = 0; j <= S; j++) { const th = j / S * Math.PI * 2, rad = nx.clone().multiplyScalar(Math.cos(th)).addScaledVector(ny, Math.sin(th));
        const rr = typeof o.rTh === 'function' ? r * o.rTh(th, t, s) : r;
        const p = pts[k].clone().addScaledVector(rad, rr), nn = out ? rad.clone().multiplyScalar(0.6).addScaledVector(out, 0.4).normalize() : rad;
        const tan = o.around ? rad.clone().cross(d).normalize() : d;
        const a = [o.around ? j / S : t, o.depth ?? 0, o.rand ?? 0, o.grey ?? 0];
        if (o.around) this._v(p, nn, u0 + (u1 - u0) * (s / (o.vScale ?? 0.05) % 1), j / S * (o.turns ?? 1), tan, a, si, sw, o.morph);
        else this._v(p, nn, u0 + (u1 - u0) * j / S, s / (o.vScale ?? 0.05), tan, a, si, sw, o.morph); }
      if (k) for (let j = 0; j < S; j++) { const a = base + (k - 1) * (S + 1) + j, b = a + S + 1; this.IX.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    this.tubes++;
  }
  geometry() {
    const g = new THREE.BufferGeometry(), n = this.count;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2)); g.setAttribute('aHairT', new THREE.Float32BufferAttribute(this.T, 3));
    g.setAttribute('aHair', new THREE.Float32BufferAttribute(this.A, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.IX, 1) : new THREE.Uint16BufferAttribute(this.IX, 1));
    if (this.M) { g.morphAttributes.position = this.M.map(m => new THREE.Float32BufferAttribute(m, 3)); g.morphTargetsRelative = true; }
    g.userData = { cards: this.cards, tubes: this.tubes, verts: n, tris: this.IX.length / 3 };
    return g;
  }
}
// HAIR4 (round 4, opt-in: groomHero rev 4): the scalp's builder. A card whose tile is one of the baked PERIODIC tiles (atlas.js
// atlas4Textures) repeats it along its length every `4 x its root width` (the tile is 1 : 4), so a ringlet or a coil keeps its own size
// whatever the card's length (lane D's cards stretched one tile over the whole card). An optional per-vertex sway weight (aSway: 0 at
// the root and where the hair rests on the body, rising along what hangs free) for a motion pass to swing; ropes set it (v3.js).
export class CardBuilder4 extends CardBuilder {
  constructor(o = {}) { super(o); this.S = []; this.vK = o.vK ?? 4; }
  _v(p, n, u, v, t, a, si, sw, md) { super._v(p, n, u, v, t, a, si, sw, md); this.S.push(this._sw ?? 0); }
  // (the card's random also carries its tile, rand = (slot + rand) / 16, so an export can tell a ringlet card from a straight one:
  // person_hair.py grows a ringlet's strands round its card for Cycles; in the shader it stays a uniform random)
  ribbon(pts, o) { const tl = o.tile || 'straight', slot = TILE[tl] ?? TILE4[tl] ?? 0;
    o = { ...o, rand: (slot + Math.min(0.999, Math.max(0, o.rand ?? 0))) / 16, ...(o.vScale == null && PERIODIC4[tl] ? { vScale: this.vK * (o.w0 ?? 0.012) * (o.vK ?? 1) } : {}) };
    this._sw = typeof o.sway === 'number' ? o.sway : 0; try { super.ribbon(pts, o); } finally { this._sw = 0; } }   // (HAIR7 c6 it 2) a ribbon off a rope carries the rope's sway at its root (one weight a card)
  tube(pts, o) { if (!o.sway) { this._sw = 0; return super.tube(pts, o); }
    // the sway per ring: tube() emits S + 1 vertices per point in order, so wrap _v to look the ring's weight up
    const S = o.sides ?? 8, per = S + 1, base = this.count, sw = o.sway, v0 = this._v.bind(this); let i = 0;
    this._v = (...a) => { this._sw = sw[Math.min(sw.length - 1, Math.floor(i++ / per))]; v0(...a); };
    try { super.tube(pts, o); } finally { delete this._v; this._sw = 0; void base; } }
  geometry() { const g = super.geometry(); if (this.S.some(x => x > 0)) g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.S, 1)); return g; }
}
export { V, sstep, clamp, mulberry, proj };
