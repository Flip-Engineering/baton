// GARMENT (HUMAN c7): real parts for hero.js clothes, where c6 had shells and paint. All bind-space, skinned to the hero's own
// bones, built once when a hero is made with { c7: true } (hero.js calls these; nothing here runs for older figures).
//
//   drapeShell(...)   a cloth-drape pass on a shell: the chest panel as a tensioned membrane (PBD distance constraints a few % short
//                     of rest, pinned where the garment is held: shoulders, side seams, waist) colliding with the smoothed skin. Cloth
//                     over a bust bridges apex to apex and falls from each apex in a straight line, rounding OVER the apex where it
//                     touches, instead of the c6 cone (a slice hull below and a straight tent above met at a crease).
//                     Mueller et al., "Position Based Dynamics" (2007); the sim-once-and-bake approach of game garment pipelines.
//   rim(...)          a garment edge with a thickness: the shader-cut boundary of a shell (vest armholes, V neck, hem, zip; a cuff; a
//                     trouser hem) traced on the mesh by marching triangles, chained, and swept with an elliptical binding that wraps
//                     the edge (rn across the cloth, rt along it). The edge reads as bound tape or a turned hem with a step, and casts.
//   collar(...)       a collar as geometry that closes over the neck: a stand round the neckline and (for shirts, coats, coveralls) a
//                     fall turned over it onto the shoulders, the points dipping into the open neck; it covers the cut skin edge.
//   bootsC7(...)      a work boot from parts: an upper on a separate sole that is wider than it (the welt, 7 mm all round), a 30 mm
//                     heel block and a 20 mm forefoot with an arch between, lug grooves, a raised toe box, a 7-inch shaft with a
//                     padded collar, laces and eyelets (shader).
//   skirtC7(...)      the coat skirt in two halves split at a back vent, overlapping 3 cm at the front, each half skinned more and
//                     more to its own thigh toward the hem (so a stride opens the coat instead of pushing a thigh through it), with
//                     patch pockets sewn ON (a 3 mm step at the edge).
import * as THREE from 'three';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// ---------------------------------------------------------------- the drape
// X: shell positions (m*3, in place), PR(k,c): the smoothed skin reference, NK: smoothed normals, off: thickness per vertex,
// faces: body-vertex triangles, used: body vertex -> shell index, region(k): 0..1 mobility (0 pinned), opts: { its, shrink, keep }
export function drapeShell(X, PR, NK, off, faces, used, mob, { its = 220, shrink = 0.05, keep = 0.85, gravity = 0.00004, roundIts = 32, squash = 0.9, bend = 0.04, fillet = 0.02 } = {}) {
  const m = X.length / 3, E = new Map();
  for (let t = 0; t < faces.length; t += 3) { const a = used.get(faces[t]), b = used.get(faces[t + 1]), c = used.get(faces[t + 2]);
    for (const [i, j] of [[a, b], [b, c], [c, a]]) { if (mob[i] <= 0 && mob[j] <= 0) continue; const k = i < j ? i * m + j : j * m + i; if (!E.has(k)) E.set(k, [Math.min(i, j), Math.max(i, j)]); } }
  const ed = [...E.values()], L = new Float32Array(ed.length);
  // tension runs DOWN the panel (from the shoulders over the apex to the waist, where the garment is held); across it the cloth is
  // loose (a work shirt has ease round the ribs), so horizontal edges only resist stretching: no horizontal wrap under the bust
  ed.forEach(([i, j], e) => { const dx = X[i * 3] - X[j * 3], dy = X[i * 3 + 1] - X[j * 3 + 1], dz = X[i * 3 + 2] - X[j * 3 + 2], l = Math.hypot(dx, dy, dz), vert = sstep(0.45, 0.8, Math.abs(dy) / (l || 1));
    L[e] = l * (1 - shrink * vert * Math.min(mob[i], mob[j])); });
  const act = []; for (let k = 0; k < m; k++) if (mob[k] > 0) act.push(k);
  // the reference the cloth rests on: the skin with its small convex bumps squashed. A body mesh's breast (and pectoral) ends in a
  // cone; cloth in tension over soft tissue presses that tip in and rounds over a contact patch instead of tenting to a point.
  // RS = the skin smoothed over a few cm (Laplacian, roundIts passes); where the skin stands proud of RS (prominence p > 0, the tip)
  // the collision surface is lowered by squash x p.
  const nbr = Array.from({ length: m }, () => []); for (const [i, j] of ed) { nbr[i].push(j); nbr[j].push(i); }
  const RF = new Float32Array(m * 3); for (let k = 0; k < m; k++) for (let c = 0; c < 3; c++) RF[k * 3 + c] = PR(k, c);
  let RS = new Float32Array(RF);
  for (let it = 0; it < roundIts; it++) { const Y = new Float32Array(RS);
    for (const k of act) { const S = nbr[k]; if (!S.length) continue; let sx = 0, sy = 0, sz = 0; for (const j of S) { sx += RS[j * 3]; sy += RS[j * 3 + 1]; sz += RS[j * 3 + 2]; }
      Y[k * 3] += 0.5 * (sx / S.length - RS[k * 3]); Y[k * 3 + 1] += 0.5 * (sy / S.length - RS[k * 3 + 1]); Y[k * 3 + 2] += 0.5 * (sz / S.length - RS[k * 3 + 2]); } RS = Y; }
  for (const k of act) { const p = (RF[k * 3] - RS[k * 3]) * NK[k * 3] + (RF[k * 3 + 1] - RS[k * 3 + 1]) * NK[k * 3 + 1] + (RF[k * 3 + 2] - RS[k * 3 + 2]) * NK[k * 3 + 2];
    if (p > 0) for (let c = 0; c < 3; c++) RF[k * 3 + c] -= NK[k * 3 + c] * p * squash * mob[k]; }
  const REF = (k, c) => RF[k * 3 + c];
  let moved = 0;
  for (let it = 0; it < its; it++) {
    for (let e = 0; e < ed.length; e++) { const [i, j] = ed[e], wi = mob[i], wj = mob[j], ws = wi + wj; if (ws <= 0) continue;
      const dx = X[j * 3] - X[i * 3], dy = X[j * 3 + 1] - X[i * 3 + 1], dz = X[j * 3 + 2] - X[i * 3 + 2], d = Math.hypot(dx, dy, dz); if (d <= L[e] || d < 1e-9) continue;   // cloth resists stretch, not compression
      const c = (d - L[e]) / d / ws * 0.9; X[i * 3] += dx * c * wi; X[i * 3 + 1] += dy * c * wi; X[i * 3 + 2] += dz * c * wi; X[j * 3] -= dx * c * wj; X[j * 3 + 1] -= dy * c * wj; X[j * 3 + 2] -= dz * c * wj; }
    if (bend > 0) { const Y = new Float32Array(X); for (const k of act) { const S = nbr[k]; if (!S.length) continue; let sx = 0, sy = 0, sz = 0; for (const j of S) { sx += X[j * 3]; sy += X[j * 3 + 1]; sz += X[j * 3 + 2]; } const w = bend * mob[k];
      Y[k * 3] += w * (sx / S.length - X[k * 3]); Y[k * 3 + 1] += w * (sy / S.length - X[k * 3 + 1]); Y[k * 3 + 2] += w * (sz / S.length - X[k * 3 + 2]); } X.set(Y); }
    for (const k of act) { X[k * 3 + 1] -= gravity * mob[k];
      const s = (X[k * 3] - REF(k, 0)) * NK[k * 3] + (X[k * 3 + 1] - REF(k, 1)) * NK[k * 3 + 1] + (X[k * 3 + 2] - REF(k, 2)) * NK[k * 3 + 2], need = off[k] * keep;
      if (s < need) { const q = need - s; X[k * 3] += NK[k * 3] * q; X[k * 3 + 1] += NK[k * 3 + 1] * q; X[k * 3 + 2] += NK[k * 3 + 2] * q; if (it === its - 1) moved++; } }
  }
  // the profile: per vertical strip (1.2 cm of x), the cloth in profile is the upper convex hull of the body (+ thickness) in the
  // (y, z) plane, from the waist (where the garment is held) over the apex to the collarbones: straight lines where it hangs free
  // (the tent above, the fall below), and the apex rounded by a fillet (the hull smoothed with a Gaussian of sigma, which keeps
  // straight lines straight and lowers the peak a few mm: the press of the cloth). Front-facing panel only (mob x NK.z).
  if (fillet > 0) { const BW = 0.012, bins = new Map();
    for (const k of act) { const b = Math.round(X[k * 3] / BW); (bins.get(b) || bins.set(b, []).get(b)).push(k); }
    const prof = new Map();
    for (const [b, ks] of bins) { const pts = ks.map(k => [REF(k, 1) + NK[k * 3 + 1] * off[k] * keep, REF(k, 2) + NK[k * 3 + 2] * off[k] * keep]).sort((p, q) => p[0] - q[0]);
      if (pts.length < 4) continue; const hu = []; for (const p of pts) { while (hu.length >= 2) { const a = hu[hu.length - 2], c = hu[hu.length - 1]; if ((c[0] - a[0]) * (p[1] - a[1]) - (c[1] - a[1]) * (p[0] - a[0]) >= 0) hu.pop(); else break; } hu.push(p); }
      const zh = y => { if (y <= hu[0][0]) return hu[0][1]; for (let i = 1; i < hu.length; i++) if (y <= hu[i][0]) { const u = (y - hu[i - 1][0]) / (hu[i][0] - hu[i - 1][0]); return hu[i - 1][1] + (hu[i][1] - hu[i - 1][1]) * u; } return hu[hu.length - 1][1]; };
      const y0 = pts[0][0], y1 = pts[pts.length - 1][0], st = 0.004, G = []; for (let y = y0; y <= y1 + 1e-9; y += st) { let a = 0, w = 0; for (let d = -3 * fillet; d <= 3 * fillet; d += st) { const yy = Math.min(y1, Math.max(y0, y + d)), g = Math.exp(-0.5 * (d / fillet) ** 2); a += g * zh(yy); w += g; } G.push(a / w); }
      prof.set(b, y => G[Math.max(0, Math.min(G.length - 1, Math.round((y - y0) / st)))]); }
    for (const k of act) { const b = Math.round(X[k * 3] / BW), f = prof.get(b); if (!f) continue; const w = mob[k] * sstep(0.35, 0.7, NK[k * 3 + 2]); if (w <= 0) continue;
      const zt = f(X[k * 3 + 1]); X[k * 3 + 2] += (zt - X[k * 3 + 2]) * w; } }
  return { edges: ed.length, active: act.length, onSkin: moved };
}

// ---------------------------------------------------------------- the rim
// g: a shell geometry (bind positions, skin attributes, aHero), cut(p: Vector3, ah: [reg, along, side, w]) -> signed distance-ish
// (> 0 kept). Returns a skinned tube geometry along every boundary of the kept part, or null.
export function rim(g, cut, { rn = 0.004, rt = 0.006, inset = 0.3, M = 8, minSeg = 0.004, smooth = 3 } = {}) {
  const P = g.attributes.position.array, AH = g.attributes.aHero.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, idx = g.index.array, n = P.length / 3;
  if (!g.attributes.normal) g.computeVertexNormals(); const N = g.attributes.normal.array;
  const f = new Float32Array(n), p = V3();
  for (let v = 0; v < n; v++) { p.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); f[v] = cut(p, [AH[v * 4], AH[v * 4 + 1], AH[v * 4 + 2], AH[v * 4 + 3]]); }
  // marching triangles: nodes live on crossed edges (keyed by the edge), segments join the two crossings of one triangle
  const node = new Map(), nodes = [], adj = [];
  const nodeOn = (a, b) => { const k = a < b ? a * n + b : b * n + a; let id = node.get(k); if (id != null) return id;
    const t = f[a] / (f[a] - f[b]), q = []; for (let c = 0; c < 3; c++) q.push(P[a * 3 + c] + (P[b * 3 + c] - P[a * 3 + c]) * t);
    const nn = []; for (let c = 0; c < 3; c++) nn.push(N[a * 3 + c] + (N[b * 3 + c] - N[a * 3 + c]) * t);
    const inV = f[a] > 0 ? a : b, outV = f[a] > 0 ? b : a;
    id = nodes.length; nodes.push({ p: V3(...q), n: V3(...nn).normalize(), w: t < 0.5 ? a : b, inV, outV }); adj.push([]); node.set(k, id); return id; };
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2], s = [f[a] > 0, f[b] > 0, f[c] > 0]; if (s[0] === s[1] && s[1] === s[2]) continue;
    const cr = []; for (const [u, v] of [[a, b], [b, c], [c, a]]) if ((f[u] > 0) !== (f[v] > 0)) cr.push(nodeOn(u, v));
    if (cr.length === 2 && cr[0] !== cr[1]) { adj[cr[0]].push(cr[1]); adj[cr[1]].push(cr[0]); } }
  // chain into polylines
  const seen = new Uint8Array(nodes.length), lines = [];
  for (let s = 0; s < nodes.length; s++) { if (seen[s] || !adj[s].length) continue;
    let start = s; { let prev = -1, cur = s, guard = 0; while (guard++ < nodes.length) { const nx = adj[cur].find(x => x !== prev); if (adj[cur].length < 2 || nx == null || nx === s) break; if (adj[cur].length === 1) break; prev = cur; cur = nx; } if (adj[cur].length === 1) start = cur; }
    const line = [start]; seen[start] = 1; let prev = -1, cur = start, closed = false;
    for (;;) { const nx = adj[cur].find(x => x !== prev && !seen[x]); if (nx == null) { closed = adj[cur].includes(start) && line.length > 2; break; } seen[nx] = 1; line.push(nx); prev = cur; cur = nx; }
    if (line.length >= 3) lines.push({ ids: line, closed }); }
  if (!lines.length) return null;
  const OP = [], OSI = [], OSW = [], OAH = [], IDX = [];
  for (const L of lines) {
    // resample: drop nodes closer than minSeg, then smooth the positions (the marching path zig-zags across triangles)
    const ids = [L.ids[0]]; for (let i = 1; i < L.ids.length; i++) if (nodes[L.ids[i]].p.distanceTo(nodes[ids[ids.length - 1]].p) > minSeg) ids.push(L.ids[i]);
    if (ids.length < 3) continue;
    let pts = ids.map(i => nodes[i].p.clone()); const K = pts.length;
    for (let s2 = 0; s2 < smooth; s2++) pts = pts.map((q, i) => { if (!L.closed && (i === 0 || i === K - 1)) return q; const a = pts[(i - 1 + K) % K], b = pts[(i + 1) % K]; return q.clone().multiplyScalar(0.5).addScaledVector(a, 0.25).addScaledVector(b, 0.25); });
    const base = OP.length / 3;
    for (let i = 0; i < K; i++) { const nd = nodes[ids[i]], a = pts[L.closed ? (i - 1 + K) % K : Math.max(0, i - 1)], b = pts[L.closed ? (i + 1) % K : Math.min(K - 1, i + 1)];
      const T = b.clone().sub(a).normalize(), nrm = nd.n.clone().addScaledVector(T, -nd.n.dot(T)).normalize();
      let I = V3().crossVectors(nrm, T).normalize(); const toIn = V3(P[nd.inV * 3] - P[nd.outV * 3], P[nd.inV * 3 + 1] - P[nd.outV * 3 + 1], P[nd.inV * 3 + 2] - P[nd.outV * 3 + 2]); if (I.dot(toIn) < 0) I.negate();
      const c = pts[i].clone().addScaledVector(I, rt * inset), w = nd.w;
      for (let j = 0; j < M; j++) { const th = j / M * Math.PI * 2, q = c.clone().addScaledVector(I, -Math.cos(th) * rt).addScaledVector(nrm, Math.sin(th) * rn);
        OP.push(q.x, q.y, q.z); for (let cc = 0; cc < 4; cc++) { OSI.push(SI[w * 4 + cc]); OSW.push(SW[w * 4 + cc]); } OAH.push(AH[w * 4], AH[w * 4 + 1], AH[w * 4 + 2], 1 + j / M); } }
    const segs = L.closed ? K : K - 1;
    for (let i = 0; i < segs; i++) { const i2 = (i + 1) % K; for (let j = 0; j < M; j++) { const j2 = (j + 1) % M, a = base + i * M + j, b = base + i * M + j2, c = base + i2 * M + j, d = base + i2 * M + j2; IDX.push(a, c, b, b, c, d); } }
  }
  if (!IDX.length) return null;
  const G = new THREE.BufferGeometry();
  G.setAttribute('position', new THREE.Float32BufferAttribute(OP, 3)); G.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(OSI, 4)); G.setAttribute('skinWeight', new THREE.Float32BufferAttribute(OSW, 4));
  G.setAttribute('aHero', new THREE.Float32BufferAttribute(OAH, 4)); G.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(OP.length / 3 * 2), 2));
  G.setIndex(IDX); G.computeVertexNormals(); G.userData.lines = lines.length;
  return G;
}
// the shader cuts of hero.js, as functions (they must match CLOTH_FRAG): vest (cVest = shoulder x, armpit y, neck y, hem y), cuff, trouser hem
export const CUTS = {
  vest: cv => (p) => { const ax = Math.abs(p.x), BIG = 0.05; let f = p.y - cv.w;
    if (p.y > cv.y - 0.02) f = Math.min(f, (cv.x - 0.045 - 0.05 * sstep(cv.y, cv.z, p.y)) - ax);
    const vneck = cv.z - 0.2 + 2.2 * Math.max(0, ax - 0.004); if (p.z > 0 && ax < 0.11) f = Math.min(f, vneck - p.y);
    if (p.y > cv.z - 0.03) f = Math.min(f, ax - 0.055, 0.145 - ax);
    if (p.z > 0) f = Math.min(f, ax - 0.006);
    return Math.min(f, BIG); },
  cuff: armEnd => (p, ah) => (ah[0] > 2.5 && ah[0] < 5.5) ? armEnd - ah[1] : 0.5,
  hem: legEnd => (p, ah) => (ah[0] > 8.55 && ah[0] < 10.5) ? legEnd - ah[1] : 0.5,
};

// ---------------------------------------------------------------- the collar
// h: the hero (bind data: head0, idx, hems), pos/REG/AH/SI/SW: body arrays, kind: 'shirt' | 'coat' | 'band'
// CLOTHING c1 (fit: true, hero.js under o.cloth): the collar is a stand and a fall turned over it, ONE strip of quads in c7, so the fall's
// visible face was the strip's back face (shaded with its normal into the shoulders: the dark flaps). With fit the strip is split at the
// turn (the top ring of the stand doubled) and the fall wound the other way, so both visible faces are front faces with their own
// normals and a crease at the turn; the fall lies 2.5 mm on the garment (not 4) and takes its skin weights from the garment under it
// (the top shell's nearest vertices), so a posed shoulder carries the fall with the cloth it rests on instead of lifting it off.
// HUMAN c8 HOOKS (seam 16): per collar column, the drawn neckline height: the highest point of the garment shell TP in that direction
// (along > 0, within 1.5 cm of the ray, under y0 + 2 cm), and no higher than the shader's cut (a tee: 5 cm deep at the front, y0 behind)
function edgeY(TP, y0, cx, cz, NC, a0, kind) {
  const out = new Float64Array(NC + 1);
  for (let i = 0; i <= NC; i++) { const a = a0 + (2 * Math.PI - 2 * a0) * i / NC, ux = Math.sin(a), uz = Math.cos(a); let top = -1e9;
    for (let k = 0; k < TP.length; k += 3) { const y = TP[k + 1]; if (y > y0 + 0.02 || y < y0 - 0.12) continue; const dx = TP[k] - cx, dz = TP[k + 2] - cz, along = dx * ux + dz * uz, perp = Math.abs(dx * uz - dz * ux);
      if (along > 0 && along < 0.13 && perp < 0.015 && y > top) top = y; }
    const cut = y0 - (kind === 'band' && uz > 0 ? 0.05 * Math.exp(-(((ux * 0.06) / 0.035) ** 2)) : 0);
    out[i] = Math.min(top > -1e8 ? top : y0, cut) + 0.004; }
  for (let it = 0; it < 4; it++) { const c = Float64Array.from(out); for (let i = 1; i < NC; i++) out[i] = 0.25 * c[i - 1] + 0.5 * c[i] + 0.25 * c[i + 1]; }
  for (let i = 0; i <= NC; i++) out[i] = Math.min(y0, Math.max(y0 - 0.09, out[i]));
  return out;
}
export function collar(h, pos, REG, SI, SW, R, { kind = 'shirt', stand = null, fall = null, gap = 0.5, onto = null, fit = false, edge = false } = {}) {
  const H = h.hems, n = h.meta.n, y0 = H.neckY, st = stand ?? (kind === 'coat' ? 0.034 : kind === 'band' ? 0.014 : 0.028), fl = fall ?? (kind === 'coat' ? 0.06 : kind === 'band' ? 0 : 0.04);
  // the neck's cross-section by height: a radial profile about its centre
  const cand = []; for (let v = 0; v < n; v++) { const r = REG[v]; if ((r === R.neck || r === R.torso || r === R.head || r === R.jaw) && (Math.abs(pos[v * 3 + 1] - y0 - 0.01) < 0.06 || (edge && pos[v * 3 + 1] < y0 && pos[v * 3 + 1] > y0 - 0.1))) cand.push(v); }
  let cx = 0, cz = 0, c = 0; for (const v of cand) if (Math.abs(pos[v * 3 + 1] - y0 - 0.03) < 0.012 && REG[v] === R.neck) { cx += pos[v * 3]; cz += pos[v * 3 + 2]; c++; } cx /= c || 1; cz /= c || 1;
  for (let i = cand.length - 1; i >= 0; i--) { const v = cand[i]; if (Math.hypot(pos[v * 3] - cx, pos[v * 3 + 2] - cz) > 0.085) cand.splice(i, 1); }   // the neck, not the shoulders
  const NA = 40, radial = (y, a) => { const ux = Math.sin(a), uz = Math.cos(a); let best = 0;
    for (const v of cand) { if (Math.abs(pos[v * 3 + 1] - y) > 0.008 || REG[v] === R.head) continue; const dx = pos[v * 3] - cx, dz = pos[v * 3 + 2] - cz, along = dx * ux + dz * uz, perp = Math.abs(dx * uz - dz * ux); if (along > 0 && perp < 0.012) best = Math.max(best, along); }
    return best || 0.06; };
  // the garment under the fall (the top shell's positions): the fall lies ON it, 4 mm off, instead of standing out at a fixed radius
  const TP = onto ? onto.attributes.position.array : null, topR = (y, a) => { if (!TP) return 0; const ux = Math.sin(a), uz = Math.cos(a); let best = 0;
    for (let k = 0; k < TP.length; k += 3) { if (Math.abs(TP[k + 1] - y) > 0.01) continue; const dx = TP[k] - cx, dz = TP[k + 2] - cz, along = dx * ux + dz * uz, perp = Math.abs(dx * uz - dz * ux); if (along > 0 && perp < 0.015) best = Math.max(best, along); } return best; };
  const vdip = x => -0.05 * Math.exp(-((x / 0.035) ** 2));     // the shirt's open V (CLOTH_FRAG neckline)
  // rings: [dy over the neckline, extra radius]: tucked inside the top, the stand, the turn (rounded), the fall onto the shoulders
  const rings = [[-0.022, 0.004], [-0.004, 0.006], [st * 0.5, 0.006], [st, 0.007], [st + 0.004, 0.011]];
  if (fl > 0) rings.push([st - 0.004, 0.017], [st - fl * 0.45, 0.024 + fl * 0.12], [st - fl, 0.03 + fl * 0.25]);
  else rings.push([st - 0.004, 0.012]);
  const a0 = kind === 'band' ? 0.02 : gap, P = [], S = [], Wt = [], AHo = [], IDX = [], NC = Math.round(NA * (1 - a0 / Math.PI));
  const prof = new Map(); const rad = (y, a) => { const k = Math.round(y * 200) + '_' + Math.round(a * 40); if (!prof.has(k)) prof.set(k, radial(y, a)); return prof.get(k); };
  // HUMAN c8 HOOKS (seam 16, opt-in edge: true): the base follows the garment's DRAWN neckline per column, min(the shell's top edge,
  // the shader's cut), instead of the cut line y0: a tee's shell ends ~4 cm under y0 at the back (its relaxed open edge), so the band
  // stood on the bare neck above it as a dark tab. Clamped to 9 cm under y0, smoothed round the neck; below the neck the rings lie on the shirt.
  const EY = edge && TP ? edgeY(TP, y0, cx, cz, NC, a0, kind) : null, Y0 = i => EY ? EY[i] : y0;
  const RR = [], YY = [];
  for (let i = 0; i <= NC; i++) { const a = a0 + (2 * Math.PI - 2 * a0) * i / NC, ux = Math.sin(a), uz = Math.cos(a), y0 = Y0(i); RR.push([]); YY.push([]);
    rings.forEach(([dy, dr], j) => { const yS = y0 + Math.min(dy, st), r = Math.max(rad(Math.max(y0 - 0.01, yS), a), rad(y0, a) * (dy < 0 ? 1 : 0.9)) + dr;
      const yy = y0 + dy + (uz > 0 && kind !== 'band' ? vdip(ux * r) * (0.6 + 0.4 * clamp(1 - j / rings.length)) : 0);
      let rr = r; if (j >= 5 && TP) { const tr = topR(yy, a); if (tr > 0) rr = fit ? Math.max(r - 0.012, tr + 0.0025 + 0.001 * (j - 5)) : Math.max(r - 0.01, tr + 0.004 + 0.002 * (j - 5)); }   // the fall rings rest on the garment
      if (j <= 1 && TP) { const tr = topR(y0 - 0.008, a); if (tr > 0) rr = Math.max(rr, tr - (j === 0 ? 0.006 : -0.002)); }        // the band starts AT the garment's neck edge (no gap down into the coat)
      if (j === 2 && TP) { const tr = topR(y0 - 0.008, a); if (tr > 0) rr = Math.max(rr, 0.5 * (rr + tr)); }
      if (EY && j >= 1 && TP) { const tr = topR(yy, a); if (tr > 0) rr = Math.max(rr, tr + 0.0025); }   // HOOKS: down on the chest the band lies ON the shirt (the neck profile ends there)
      RR[i].push(rr); YY[i].push(yy); }); }
  // smooth round the neck (the sampled radii are noisy column to column) and keep each ring outside the one before it
  for (let it = 0; it < 6; it++) for (let j = 0; j < rings.length; j++) { const c = RR.map(r => r[j]); for (let i = 1; i < NC; i++) RR[i][j] = 0.25 * c[i - 1] + 0.5 * c[i] + 0.25 * c[i + 1]; }
  for (let i = 0; i <= NC; i++) for (let j = 4; j < rings.length; j++) RR[i][j] = Math.max(RR[i][j], RR[i][3] + 0.002 * (j - 3));
  const near = cand.filter(v => REG[v] !== R.head && REG[v] !== R.jaw);
  for (let i = 0; i <= NC; i++) { const a = a0 + (2 * Math.PI - 2 * a0) * i / NC, ux = Math.sin(a), uz = Math.cos(a), y0 = Y0(i);
    for (let j = 0; j < rings.length; j++) { const rr = RR[i][j], x = cx + ux * rr, z = cz + uz * rr, y = YY[i][j];
      P.push(x, y, z);
      // weights: blended from the 10 nearest body vertices (one nearest vertex per column switched bones between neighbours: shards when posed)
      const ds = near.map(v => [v, (pos[v * 3] - x) ** 2 + (pos[v * 3 + 1] - Math.min(y, y0 + st * 0.5)) ** 2 * 2 + (pos[v * 3 + 2] - z) ** 2]).sort((p, q) => p[1] - q[1]).slice(0, 10), m = new Map();
      for (const [v, d] of ds) { const wv = 1 / (d + 1e-5); for (let k = 0; k < 4; k++) { const b = SI[v * 4 + k], w = SW[v * 4 + k] * wv; if (w > 0) m.set(b, (m.get(b) || 0) + w); } }
      const arr = [...m.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4), sum = arr.reduce((q, e) => q + e[1], 0) || 1; while (arr.length < 4) arr.push([0, 0]);
      for (const [b, w] of arr) { S.push(b); Wt.push(w / sum); } AHo.push(R.torso, 0, x > 0 ? 1 : -1, j / (rings.length - 1)); } }
  const NR = rings.length;
  if (fit && fl > 0 && onto) {   // CLOTHING c1: the fall's weights from the garment it lies on; the strip split at the turn (ring 4), the fall re-wound
    const OP = onto.attributes.position.array, OI = onto.attributes.skinIndex.array, OW = onto.attributes.skinWeight.array, no = OP.length / 3;
    for (let i = 0; i <= NC; i++) for (let j = 5; j < NR; j++) { const k = i * NR + j, x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2], best = [];
      for (let v = 0; v < no; v++) { const d = (OP[v * 3] - x) ** 2 + (OP[v * 3 + 1] - y) ** 2 + (OP[v * 3 + 2] - z) ** 2; if (best.length < 6 || d < best[5][1]) { best.push([v, d]); best.sort((p, q) => p[1] - q[1]); if (best.length > 6) best.pop(); } }
      const m = new Map(); for (const [v, d] of best) { const wv = 1 / (d + 1e-6); for (let c = 0; c < 4; c++) { const b = OI[v * 4 + c], w = OW[v * 4 + c] * wv; if (w > 0) m.set(b, (m.get(b) || 0) + w); } }
      const arr = [...m.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4), sum = arr.reduce((q, e) => q + e[1], 0) || 1; while (arr.length < 4) arr.push([0, 0]);
      for (let c = 0; c < 4; c++) { S[k * 4 + c] = arr[c][0]; Wt[k * 4 + c] = arr[c][1] / sum; } }
    const base = P.length / 3, dup = i => base + i;                     // ring 4 doubled: the fall's own copy
    for (let i = 0; i <= NC; i++) { const k = i * NR + 4; P.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]); for (let c = 0; c < 4; c++) { S.push(S[k * 4 + c]); Wt.push(Wt[k * 4 + c]); } for (let c = 0; c < 4; c++) AHo.push(AHo[k * 4 + c]); }
    for (let i = 0; i < NC; i++) for (let j = 0; j < NR - 1; j++) { let a = i * NR + j, b = a + 1, c2 = a + NR, d = c2 + 1;
      if (j < 4) IDX.push(a, c2, b, b, c2, d);
      else { if (j === 4) { a = dup(i); c2 = dup(i + 1); } IDX.push(a, b, c2, b, d, c2); } }
  } else
  for (let i = 0; i < NC; i++) for (let j = 0; j < NR - 1; j++) { const a = i * NR + j, b = a + 1, c2 = a + NR, d = c2 + 1; IDX.push(a, c2, b, b, c2, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(S, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Wt, 4));
  g.setAttribute('aHero', new THREE.Float32BufferAttribute(AHo, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2));
  g.setIndex(IDX); g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- the boot
// returns [upper L, sole L, upper R, sole R] geometries (bind space) and the lace frames for the shader
export function bootsC7(h, pos, REG, R) {
  const I = h.idx, n = h.meta.n, out = [], lace = [];
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let v = 0; v < n; v++) if (REG[v] === R.foot && Math.sign(pos[v * 3]) === sg) { x0 = Math.min(x0, pos[v * 3]); x1 = Math.max(x1, pos[v * 3]); z0 = Math.min(z0, pos[v * 3 + 2]); z1 = Math.max(z1, pos[v * 3 + 2]); }
    const ank = h.head0[I['foot.' + side]], toeJ = h.head0[I['toe1-1.' + side]], cx = (x0 + x1) / 2, W = (x1 - x0) / 2 + 0.01, L = z1 - z0 + 0.03, zh = z0 - 0.012;
    const bF = I['foot.' + side], bT = I['toe1-1.' + side], bS = I['lowerleg02.' + side], toeZ = toeJ.z;
    const soleTop = t => t < 0.27 ? 0.032 : t < 0.3 ? 0.032 - (t - 0.27) / 0.03 * 0.012 : 0.02 + 0.004 * sstep(0.85, 1, t);   // heel block, breast, forefoot, toe spring
    const soleBot = t => t < 0.27 ? 0 : t < 0.5 ? 0.009 * Math.sin(Math.PI * (t - 0.27) / 0.23) : 0.004 * sstep(0.88, 1, t);   // the arch between heel and ball, the toe spring
    const wOf = (t, K) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const u = (t - K[i - 1][0]) / (K[i][0] - K[i - 1][0]); return K[i - 1].slice(1).map((v, c) => v + (K[i][c + 1] - v) * u); } return K[K.length - 1].slice(1); };
    // the upper: [t, half width, height (m over the sole), ] a higher, rounder toe box than c6
    const KU = [[0, 0.55, 0.075], [0.05, 0.82, 0.095], [0.14, 0.93, 0.105], [0.3, 0.92, 0.1], [0.48, 1.0, 0.075], [0.64, 1.02, 0.058], [0.78, 0.97, 0.05], [0.9, 0.84, 0.046], [0.97, 0.6, 0.038], [1, 0.25, 0.026]];
    const seg = 28, wgt = (z, y) => { const wt = sstep(toeZ - 0.02, toeZ + 0.02, z), ws = sstep(0.12, 0.2, y); return [[bF, (1 - wt) * (1 - ws)], [bT, wt * (1 - ws)], [bS, ws]]; };
    const push = (A, x, y, z, ahw) => { A.P.push(x, y, z); const w = wgt(z, y).sort((a, b) => b[1] - a[1]); for (let k = 0; k < 4; k++) { A.S.push(w[k] ? w[k][0] : 0); A.W.push(w[k] ? w[k][1] : 0); } A.H.push(y > 0.1 ? R.shin : R.foot, 2, sg, ahw); };
    const U = { P: [], S: [], W: [], H: [], I: [] };
    const rows = [];
    for (const [t, w, hh] of KU) { const base = soleTop(t), r = []; for (let i = 0; i <= seg; i++) { const th = i / seg * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), e = 2 / 3.2;
        const px = cx + W * w * Math.sign(c) * Math.pow(Math.abs(c), e), py = base - 0.002 + (sn > 0 ? hh * Math.pow(sn, 0.8) : 0.004 * sn), pz = zh + t * L;
        r.push(U.P.length / 3); push(U, px, py, pz, sn > 0.55 && t > 0.3 && t < 0.72 ? 1 : 0); } rows.push(r); }
    // the shaft: rings round the ankle up the shin to ~0.24 m (a 7-inch boot), a little flared, a padded collar turned in at the top
    const shaft = [[0.07, 0.0], [0.1, 0], [0.14, 0], [0.18, 0.002], [0.215, 0.005], [0.232, 0.009], [0.242, 0.006], [0.236, -0.004]];
    const rx0 = W * 0.98, rz0 = 0.064;
    for (const [y, dr] of shaft) { const r = [], zc = ank.z - 0.012 + (y - 0.07) * 0.02; for (let i = 0; i <= seg; i++) { const th = i / seg * Math.PI * 2, fr = Math.cos(th) > 0 ? 0 : 0; // th: 0 = +x
        const px = ank.x + (rx0 - (y - 0.07) * 0.05 + dr) * Math.cos(th), pz = zc + (rz0 - (y - 0.07) * 0.06 + dr) * Math.sin(th) + fr;
        r.push(U.P.length / 3); push(U, px, y, pz, Math.sin(th) > 0.5 ? 1 : 0); } rows.push(r); }
    const grid = (ra, rb) => { for (let i = 0; i < seg; i++) U.I.push(ra[i], rb[i], ra[i + 1], ra[i + 1], rb[i], rb[i + 1]); };
    for (let j = 0; j < KU.length - 1; j++) grid(rows[j], rows[j + 1]);
    for (let j = KU.length; j < rows.length - 1; j++) grid(rows[j], rows[j + 1]);
    // the vamp: join the top of the foot loft to the shaft (the instep rises into the shaft)
    { const top = rows[3], sh = rows[KU.length]; grid(sh, top); }
    const cap = (r, flip) => { const c0 = U.P.length / 3; let sx = 0, sy = 0, sz = 0; for (const k of r) { sx += U.P[k * 3]; sy += U.P[k * 3 + 1]; sz += U.P[k * 3 + 2]; } push(U, sx / r.length, sy / r.length, sz / r.length + (flip ? 0.004 : -0.004), 0); for (let i = 0; i < seg; i++) flip ? U.I.push(c0, r[i], r[i + 1]) : U.I.push(c0, r[i + 1], r[i]); };
    cap(rows[0], false); cap(rows[KU.length - 1], true);
    // the sole: a rounded slab under the upper, 7 mm proud of it all round (the welt), heel block, arch, forefoot
    const S = { P: [], S: [], W: [], H: [], I: [] }, NS = 40, ring = [];
    for (let k = 0; k <= NS; k++) { const t = k / NS, [w] = wOf(t, KU.map(r => [r[0], r[1]])), hw = W * w + 0.007 + (t < 0.05 || t > 0.95 ? 0.0 : 0), z = zh - 0.008 + t * (L + 0.016), yt = soleTop(t), yb = soleBot(t);
      const sec = [[-hw + 0.003, yb], [-hw, yb + 0.004], [-hw, yt - 0.003], [-hw + 0.003, yt], [hw - 0.003, yt], [hw, yt - 0.003], [hw, yb + 0.004], [hw - 0.003, yb]];
      const r = []; for (const [x, y] of sec) { r.push(S.P.length / 3); push(S, cx + x, y, z, 0); S.H[S.H.length - 1] = 0.5; S.H[S.H.length - 4] = R.foot; } ring.push(r); }
    // round the toe and heel in plan: pull the outline in at the ends
    for (let k = 0; k <= NS; k++) { const t = k / NS, e = t < 0.08 ? Math.sqrt(1 - ((0.08 - t) / 0.08) ** 2) : t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1; for (const v of ring[k]) S.P[v * 3] = cx + (S.P[v * 3] - cx) * Math.max(0.25, e); }
    for (let k = 0; k < NS; k++) for (let i = 0; i < 8; i++) { const a = ring[k][i], b = ring[k][(i + 1) % 8], c = ring[k + 1][i], d = ring[k + 1][(i + 1) % 8]; S.I.push(a, b, c, b, d, c); }
    for (const [r, flip] of [[ring[0], false], [ring[NS], true]]) for (let i = 1; i < 7; i++) flip ? S.I.push(r[0], r[i], r[i + 1]) : S.I.push(r[0], r[i + 1], r[i]);
    const mk = A => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(A.P, 3)); g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(A.S, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(A.W, 4));
      g.setAttribute('aHero', new THREE.Float32BufferAttribute(A.H, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(A.P.length / 3 * 2), 2)); g.setIndex(A.I); g.computeVertexNormals(); return g; };
    out.push(mk(U), mk(S)); lace.push({ cx, ankZ: ank.z, W });
  }
  return { geoms: out, lace };
}

// ---------------------------------------------------------------- the coat skirt in two halves
// rings: [{ y, r: [NA radii] }] from hero.js _coatSkirt (the convex-hull loft), cx, cz its axis, NA the column count; pv: pelvis vertices
// for weights; thigh: bone index per side { L, R }; returns { skirt, pockets } geometries
export function skirtC7(h, { rings, cx, cz, NA, pos, SI, SW, AH, pv, yTop, R }) {
  const I = h.idx, thigh = { L: I['upperleg01.L'], R: I['upperleg01.R'] }, NR = rings.length, yHem = rings[NR - 2].y;
  const rAt = (a, y) => { const ai = ((a / (2 * Math.PI)) % 1 + 1) % 1 * NA, i0 = Math.floor(ai) % NA, i1 = (i0 + 1) % NA, fa = ai - Math.floor(ai);
    let j = 0; while (j < NR - 3 && rings[j + 1].y > y) j++; const ry = (rings[j].y - y) / Math.max(1e-6, rings[j].y - rings[j + 1].y), u = clamp(ry);
    const r0 = rings[j].r[i0] * (1 - fa) + rings[j].r[i1] * fa, r1 = rings[j + 1].r[i0] * (1 - fa) + rings[j + 1].r[i1] * fa; return r0 + (r1 - r0) * u; };
  const weightsAt = (x, y, z, sideL) => { let bv = pv[0], bd = 1e9; for (const v of pv) { const d = (pos[v * 3] - x) ** 2 + (pos[v * 3 + 1] - yTop) ** 2 * 0.3 + (pos[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; bv = v; } }
    const t = clamp((yTop - y) / (yTop - yHem)), wt = 0.62 * Math.pow(t, 1.25), m = new Map();
    for (let k = 0; k < 4; k++) { const b = SI[bv * 4 + k], w = SW[bv * 4 + k] * (1 - wt); if (w > 0) m.set(b, (m.get(b) || 0) + w); }
    const tb = thigh[sideL ? 'L' : 'R']; m.set(tb, (m.get(tb) || 0) + wt);
    const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), s = arr.reduce((q, e) => q + e[1], 0) || 1; while (arr.length < 4) arr.push([0, 0]); return arr.map(([b, w]) => [b, w / s]); };
  const A = { P: [], S: [], W: [], H: [], I: [] }, put = (x, y, z, sideL, along = 0) => { A.P.push(x, y, z); for (const [b, w] of weightsAt(x, y, z, sideL)) { A.S.push(b); A.W.push(w); } A.H.push(R.pelvis, along, sideL ? 1 : -1, 0); return A.P.length / 3 - 1; };
  // two halves: left from 0.03 rad past the front centre (the overlap, 3 mm proud) round to the back vent at pi; right from pi to 2 pi
  const halves = [[-0.13, Math.PI - 0.004, true, 0.003], [Math.PI + 0.004, 2 * Math.PI, false, 0]], NC = 30;
  for (const [a0, a1, sideL, lift] of halves) { const base = A.P.length / 3;
    for (let i = 0; i <= NC; i++) { const a = a0 + (a1 - a0) * i / NC, ux = Math.sin(a), uz = Math.cos(a);
      rings.forEach((rg, j) => { const r = (j === 0 || j === NR - 1 ? rg.r[Math.round(((a / (2 * Math.PI)) % 1 + 1) % 1 * NA) % NA] : rAt(a, rg.y)) + lift; put(cx + ux * r, rg.y, cz + uz * r, sideL, j / (NR - 1)); }); }
    for (let i = 0; i < NC; i++) for (let j = 0; j < NR - 1; j++) { const a = base + i * NR + j, b = a + 1, c = a + NR, d = c + 1; A.I.push(a, b, c, c, b, d); } }
  // patch pockets: a panel standing 3 mm off the skirt with a 3 mm wall, on each side at the hand's height (16 x 17 cm)
  const K = { P: [], S: [], W: [], H: [], I: [] };
  for (const sideL of [true, false]) { const ac = sideL ? 0.68 : -0.68, yt = yTop - 0.045, yb = yt - 0.17, nu = 8, nv = 8;
    const rr = (a, y) => rAt(a, y) + 0.0045, aw = 0.08 / Math.max(0.12, rAt(ac, yt));   // half width 8 cm as an angle
    const pt = (u, v, dr = 0) => { const a = ac - aw + 2 * aw * u, y = yt - (yt - yb) * v, r = rr(a, y) + dr; return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r]; };
    const idx0 = K.P.length / 3, grid = [];
    for (let i = 0; i <= nu; i++) { grid.push([]); for (let j = 0; j <= nv; j++) { const [x, y, z] = pt(i / nu, j / nv); K.P.push(x, y, z); for (const [b, w] of weightsAt(x, y, z, sideL)) { K.S.push(b); K.W.push(w); } K.H.push(R.pelvis, 0, sideL ? 1 : -1, 2); grid[i].push(K.P.length / 3 - 1); } }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j], d = grid[i + 1][j + 1]; K.I.push(a, b, c, c, b, d); }
    // the wall: the outline (left, bottom, right; the top is the open mouth, folded) dropped to the skirt
    const edge = []; for (let j = 0; j <= nv; j++) edge.push([0, j]); for (let i = 1; i <= nu; i++) edge.push([i, nv]); for (let j = nv - 1; j >= 0; j--) edge.push([nu, j]); for (let i = nu - 1; i >= 1; i--) edge.push([i, 0]);
    const low = edge.map(([i, j]) => { const [x, y, z] = pt(i / nu, j / nv, -0.0045); K.P.push(x, y, z); for (const [b, w] of weightsAt(x, y, z, sideL)) { K.S.push(b); K.W.push(w); } K.H.push(R.pelvis, 0, sideL ? 1 : -1, 3); return K.P.length / 3 - 1; });
    for (let e = 0; e < edge.length; e++) { const e2 = (e + 1) % edge.length, a = grid[edge[e][0]][edge[e][1]], b = grid[edge[e2][0]][edge[e2][1]], c = low[e], d = low[e2]; K.I.push(a, c, b, b, c, d); } }
  const mk = B => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.P, 3)); g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(B.S, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(B.W, 4));
    g.setAttribute('aHero', new THREE.Float32BufferAttribute(B.H, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(B.P.length / 3 * 2), 2)); g.setIndex(B.I); g.computeVertexNormals(); return g; };
  return { skirt: mk(A), pockets: mk(K) };
}
