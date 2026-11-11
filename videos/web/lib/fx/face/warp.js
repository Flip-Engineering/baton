// FACE / WARP (HUMAN c8 P2): the face's proportions as a landmark warp. MakeHuman's face targets are shape character, not proportion:
// at full weight they move the measures by 1-3 mm (face_test.mjs prints the table), where the population spans 10-20 mm. So the measured
// proportions are placed the way morphometrics places them: each landmark gets the displacement its target measures ask for (the
// vertical chain nasion -> subnasale -> stomion -> menton, the widths at the cheekbones, jaw, nose, mouth and canthi, the pupils, head
// length and height, the ears), a ring of anchors round the neck holds the body still, and a 3D thin-plate spline (Bookstein 1989:
// U(r) = r in 3D, plus an affine part) carries the displacement smoothly to every vertex. The eyes move rigidly with their sockets.
// The warp is a FUNCTION OF POSITION (centres, weights, affine): it applies to the base mesh and to any finer mesh of the same face
// (evalWarp on P1's subdivided vertices), so it is resolution-independent like the forms.
import { clamp } from './sample.js';
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function solve(A, B) {                 // A n x n, B n x m (Gaussian elimination, partial pivoting)
  const n = A.length, m = B[0].length, M = A.map((r, i) => [...r, ...B[i]]);
  for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12; for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / d; if (f) for (let c = i; c < n + m; c++) M[r][c] -= f * M[i][c]; } }
  return M.map((r, i) => r.slice(n).map(x => x / (r[i] || 1e-12)));
}
// a thin-plate spline through control points c (k x 3) with displacements d (k x 3); lam: smoothing (m)
export function tps(c, d, lam = 1e-4) {
  const k = c.length, n = k + 4, A = Array.from({ length: n }, () => new Array(n).fill(0)), B = Array.from({ length: n }, () => [0, 0, 0]);
  for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] = Math.hypot(...sub(c[i], c[j])) + (i === j ? lam : 0);
    A[i][k] = A[k][i] = 1; for (let a = 0; a < 3; a++) A[i][k + 1 + a] = A[k + 1 + a][i] = c[i][a]; B[i] = d[i].slice(); }
  const X = solve(A, B);
  return { c, w: X.slice(0, k), a: X.slice(k) };
}
export function warpAt(W, p) {
  const o = [W.a[0][0] + W.a[1][0] * p[0] + W.a[2][0] * p[1] + W.a[3][0] * p[2], W.a[0][1] + W.a[1][1] * p[0] + W.a[2][1] * p[1] + W.a[3][1] * p[2], W.a[0][2] + W.a[1][2] * p[0] + W.a[2][2] * p[1] + W.a[3][2] * p[2]];
  for (let i = 0; i < W.c.length; i++) { const r = Math.hypot(p[0] - W.c[i][0], p[1] - W.c[i][1], p[2] - W.c[i][2]), w = W.w[i]; o[0] += w[0] * r; o[1] += w[1] * r; o[2] += w[2] * r; }
  return o;
}
// the neck ring (anchors) and the head's own region: built once per topology from the person's positions
export function headZone(F, P, region, n, nb) {
  const I = F.ids, me = [P[I.me * 3], P[I.me * 3 + 1], P[I.me * 3 + 2]], yr = me[1] - 0.045;
  const ring = [], bins = new Map();
  for (let v = 0; v < nb; v++) { if (Math.abs(P[v * 3 + 1] - yr) > 0.006) continue; const rg = region[v]; if (rg !== 1 && rg !== 0 && rg !== 11) continue;
    const a = Math.round(Math.atan2(P[v * 3 + 2] - (me[2] - 0.06), P[v * 3]) / (Math.PI / 8)); if (!bins.has(a)) bins.set(a, v); }
  for (const v of bins.values()) ring.push(v);
  // the vertices the warp may move: head, jaw and neck above the ring's fade, and the helpers (teeth, tongue, eyes) up there
  const zone = [], fade = new Float32Array(n);
  for (let v = 0; v < n; v++) { const y = P[v * 3 + 1]; if (y < yr - 0.015) continue; if (v < nb) { const rg = region[v]; if (rg !== 0 && rg !== 11 && rg !== 1) continue; }
    fade[v] = clamp((y - (yr - 0.015)) / 0.02); fade[v] = fade[v] * fade[v] * (3 - 2 * fade[v]); zone.push(v); }
  return { ring, zone, fade, yRing: yr };
}
// the displacement plan: landmark -> [dx, dy, dz] (m) from the target measures m (current) -> t (target), mm; asym in mm
// c2 (FACE c2, optional): { mas: 0.5 (the lower cheek's share of the jaw's width change; P2 0.2), extra: [{ v, d: [dx, dy, dz] frame mm }] }:
// extra control vertices (the lips' columns) with their own displacements; a vertex that is also a landmark adds to that landmark's
export function plan(F, P, cur, T, A, frame, c2 = null) {
  const I = F.ids, mm = 0.001, D = {}, x = frame.x, y = frame.y, z = frame.z;
  const put = (k, dx = 0, dy = 0, dz = 0) => { const o = D[k] || [0, 0, 0]; for (let a = 0; a < 3; a++) o[a] += (x[a] * dx + y[a] * dy + z[a] * dz) * mm; D[k] = o; };
  const has = k => T[k] != null && cur[k] != null, dv = k => has(k) ? T[k] - cur[k] : 0;   // mm
  for (const k of Object.keys(I)) if (!D[k]) D[k] = [0, 0, 0];
  // vertical chain (frame y): nasion fixed. The face length (n-me, ANSUR) sets the vertical extent, the Farkas proportions divide it
  // (nose : lower face, upper lip : lower face), all along the frame's vertical: the caliper distances n-sn, sn-me run along a bent
  // profile and do not add up to n-me, so they are reported, not placed
  const yo = k => dot(sub([P[I[k] * 3], P[I[k] * 3 + 1], P[I[k] * 3 + 2]], [P[I.n * 3], P[I.n * 3 + 1], P[I.n * 3 + 2]]), y);
  const ySn = yo('sn'), ySto = yo('sto'), yMe = yo('me');
  let dSn = 0, dSto = 0, dMe = 0;
  if (has('n-me')) { const Yme = -yMe * T['n-me'] / cur['n-me'], fs = T.fracSn ?? (-ySn / -yMe), ft = T.fracSto ?? ((ySn - ySto) / (ySn - yMe));
    const Ysn = fs * Yme, Ysto = Ysn + ft * (Yme - Ysn);
    dSn = -(Ysn + ySn) / mm; dSto = -(Ysto + ySto) / mm; dMe = -(Yme + yMe) / mm; }
  const alongY = yy => { if (yy >= 0) return 0; if (yy >= ySn) return dSn * yy / ySn; if (yy >= ySto) return dSn + (dSto - dSn) * (yy - ySn) / (ySto - ySn); return dSto + (dMe - dSto) * clamp((yy - ySto) / (yMe - ySto), 0, 1.3); };
  const along = k => alongY(yo(k));
  for (const k of ['prn', 'rhi', 'sn', 'mph', 'ls', 'sto', 'li', 'sl', 'pg', 'gn', 'me']) put(k, 0, along(k));
  for (const s of ['L', 'R']) { for (const k of ['al', 'ch', 'mm']) put(k + '_' + s, 0, along(k + '_' + s)); put('buc_' + s, 0, 0.7 * along('buc_' + s)); put('mas_' + s, 0, 0.5 * along('mas_' + s)); put('go_' + s, 0, 0.55 * dMe); }
  // widths (frame x), half to each side
  const W = { zy: dv('zy-zy'), eu: dv('eu-eu'), al: dv('al-al'), ch: dv('ch-ch'), en: dv('en-en'), ex: dv('ex-ex') };
  W.go = has('go-go') ? dv('go-go') : (cur['go-go'] || 90) * (has('zy-zy') ? T['zy-zy'] / cur['zy-zy'] - 1 : 0);
  for (const [s, sg] of [['L', 1], ['R', -1]]) {
    const h = k => sg * W[k] / 2;
    put('zy_' + s, h('zy')); put('eu_' + s, h('eu')); put('al_' + s, h('al')); put('ch_' + s, h('ch')); put('en_' + s, h('en')); put('ex_' + s, h('ex')); put('go_' + s, h('go'));
    put('ps_' + s, 0.5 * (h('en') + h('ex'))); put('pi_' + s, 0.5 * (h('en') + h('ex'))); put('so_' + s, 0.6 * h('ex') + 0.3 * h('zy')); put('or_' + s, 0.5 * h('ex') + 0.4 * h('zy'));
    const mw = c2?.mas ?? 0.2;
    put('mal_' + s, 0.3 * h('ex') + 0.7 * h('zy')); put('buc_' + s, 0.5 * h('ch') + 0.5 * h('zy')); put('mas_' + s, (1 - mw) * h('zy') + mw * h('go')); put('mm_' + s, 0.6 * h('ch') + 0.3 * h('go'));
    const ear = 0.5 * (h('eu') + h('zy')); for (const k of ['t', 'sa', 'sba', 'pra', 'pa']) put(k + '_' + s, ear);
    // ear length: half up at the top, half down at the lobe
    put('sa_' + s, 0, dv('sa-sba') / 2); put('sba_' + s, 0, -dv('sa-sba') / 2);
  }
  // head length (the occiput moves; the face stays) and height above the ears (the vertex rises)
  put('op', 0, 0, -dv('g-op')); put('v', 0, dv('t-v'));
  for (const s of ['L', 'R']) put('eu_' + s, 0, 0.4 * dv('t-v'), -0.35 * dv('g-op'));
  // pupils: the eyes translate rigidly (eyeShift per side, m)
  const dIpd = dv('ipd') / 2, eyeShift = { L: [0, 0, 0], R: [0, 0, 0] };
  for (const [s, sg] of [['L', 1], ['R', -1]]) for (let a = 0; a < 3; a++) eyeShift[s][a] = x[a] * sg * dIpd * mm;
  // asymmetry (mm): +eyeY raises the left eye and lowers the right; noseX / chinX shift to the person's left; +mouthY raises the left
  // corner (negative the right); cheek widens one cheekbone; earY raises one ear
  if (A) { const eh = A.eyeY / 2, ex = A.eyeX / 2;
    for (const [s, sg] of [['L', 1], ['R', -1]]) { for (const k of ['en', 'ex', 'ps', 'pi']) put(k + '_' + s, ex, sg * eh); put('so_' + s, 0, sg * eh * 0.7); put('or_' + s, 0, sg * eh * 0.7);
      for (let a = 0; a < 3; a++) eyeShift[s][a] += (x[a] * ex + y[a] * sg * eh) * mm;
      put('zy_' + s, (A.cheek > 0) === (sg > 0) ? sg * Math.abs(A.cheek) : 0); put('mal_' + s, (A.cheek > 0) === (sg > 0) ? sg * 0.7 * Math.abs(A.cheek) : 0);
      for (const k of ['t', 'sa', 'sba', 'pra', 'pa']) put(k + '_' + s, 0, sg * A.earY / 2); }
    for (const [k, f] of [['prn', 1], ['sn', 0.7], ['rhi', 0.35], ['al_L', 0.75], ['al_R', 0.75], ['mph', 0.4]]) put(k, A.noseX * f);
    for (const [k, f] of [['pg', 1], ['gn', 1], ['me', 1], ['sl', 0.6], ['mm_L', 0.5], ['mm_R', 0.5], ['li', 0.3]]) put(k, A.chinX * f);
    if (A.mouthY > 0) put('ch_L', 0, A.mouthY); else put('ch_R', 0, -A.mouthY);
  }
  let extra = null;
  if (c2?.extra?.length) { const byV = new Map(Object.entries(I).map(([k, v]) => [v, k])); extra = [];
    // an extra control rides the vertical chain like the landmarks round it (else the chain moves past it), plus its own move
    const yoV = v => dot(sub([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], [P[I.n * 3], P[I.n * 3 + 1], P[I.n * 3 + 2]]), y);
    for (const e of c2.extra) { const k = byV.get(e.v), dy = e.d[1] + (k ? 0 : alongY(yoV(e.v))), d = [0, 1, 2].map(a => (x[a] * e.d[0] + y[a] * dy + z[a] * e.d[2]) * mm);
      if (k) { for (let a = 0; a < 3; a++) D[k][a] += d[a]; } else extra.push({ v: e.v, d }); } }
  return { D, eyeShift, extra };
}
// build the warp: control points = every landmark (with its planned displacement) + the neck ring (held still)
export function buildWarp(F, P, zone, pl) {
  const c = [], d = [];
  for (const [k, v] of Object.entries(F.ids)) { c.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); d.push(pl.D[k] || [0, 0, 0]); }
  for (const v of zone.ring) { c.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); d.push([0, 0, 0]); }
  if (pl.extra) for (const e of pl.extra) { c.push([P[e.v * 3], P[e.v * 3 + 1], P[e.v * 3 + 2]]); d.push(e.d); }
  return tps(c, d);
}
// apply to a position array: zone vertices get the warp x fade; the eye helpers (the proxy's references) and the eye proxy move rigidly
export function applyWarp(F, W, P, E, zone, eyeShift, n) {
  const out = new Float32Array(P), eyeHelp = new Set(F.eyeRef.idx);
  for (const v of zone.zone) { if (eyeHelp.has(v)) continue; const f = zone.fade[v]; if (!f) continue; const d = warpAt(W, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    out[v * 3] += f * d[0]; out[v * 3 + 1] += f * d[1]; out[v * 3 + 2] += f * d[2]; }
  for (const v of eyeHelp) { const s = P[v * 3] > 0 ? eyeShift.L : eyeShift.R; out[v * 3] += s[0]; out[v * 3 + 1] += s[1]; out[v * 3 + 2] += s[2]; }
  let Eo = null;
  if (E) { Eo = new Float32Array(E); for (let i = 0; i < E.length / 3; i++) { const s = E[i * 3] > 0 ? eyeShift.L : eyeShift.R; Eo[i * 3] += s[0]; Eo[i * 3 + 1] += s[1]; Eo[i * 3 + 2] += s[2]; } }
  return { P: out, E: Eo };
}
// for any other point set of the same face (P1's subdivision): the displacement at each point (no fade, no eye handling)
export function evalWarp(W, points) { const out = new Float32Array(points.length); for (let i = 0; i < points.length; i += 3) { const d = warpAt(W, [points[i], points[i + 1], points[i + 2]]); out[i] = d[0]; out[i + 1] = d[1]; out[i + 2] = d[2]; } return out; }
