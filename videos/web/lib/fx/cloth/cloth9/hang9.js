// CLOTH9 (round 7): THE SLEEVE-HANG RULER. How a sleeve sits on its posed arm, read from the posed cloth and the posed body (node, no GL;
// the body WITH the skin the page culls under the clothes: labs/clothing2/cloth9/load9.mjs). AUDIT7 C2's gate: on a hanging arm the cloth
// rests on the top (outer) side of the upper arm (gap <= ~5 mm) and hangs off underneath (10-30 mm); a tee's hem girth is 1.3-1.6 x the
// arm's, a shirt sleeve above its cuff 1.1-1.3 x.
//   The arm's frame: a = shoulder -> elbow (the upper arm's axis), lat = the outward horizontal off the shoulders' midpoint made square to
//   a ('top': on an arm hanging a little away from the body this is the side gravity lays the cloth on), fwd = a x lat turned to the
//   person's front (+z), 'under' = -lat (the armpit side).
//   Stations: t = 0.15 .. 0.75 of the upper arm's length below the shoulder joint. At each, rays leave the axis at 0 (top), 90 (front),
//   180 (under) and 270 (back) degrees, +-20 degrees each (the median of three): skin = the first body hit, cloth = the first garment
//   hit beyond (skin - 1 cm); gap = cloth - skin (mm). No cloth within 15 cm: the sleeve ended above the station (null).
//   The hem ring: each closed free-edge loop of the garment lying round this arm (>= 80 % of it within 11 cm of the arm's curve): its
//   girth (the loop's own length, projected square to the arm) over the arm's girth there (the hull of the body's section), and the
//   gap at its top and under side (loop vertices within 35 degrees of top / under: their distance from the axis less the skin's).
//   sleeveHang(Xg, Tg, loops, body, J, { stations }) -> { L: { stations: [...], hem: {...} | null }, R: ... }
export const HANG9_VERSION = 1;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const perp = (v, a) => { const d = dot(v, a); return nrm([v[0] - a[0] * d, v[1] - a[1] * d, v[2] - a[2] * d]); };
// triangles whose centroid is within R of the segment S -> E2 (indices into T / 3)
export function trisNear(X, T, S, E2, R) { const out = [], ab = sub(E2, S), l2 = dot(ab, ab) || 1e-12;
  for (let t = 0; t < T.length; t += 3) { const c = [0, 0, 0]; for (let k = 0; k < 3; k++) { const v = T[t + k]; c[0] += X[v * 3] / 3; c[1] += X[v * 3 + 1] / 3; c[2] += X[v * 3 + 2] / 3; }
    const f = Math.max(0, Math.min(1, dot(sub(c, S), ab) / l2)), p = [S[0] + ab[0] * f, S[1] + ab[1] * f, S[2] + ab[2] * f]; if (dot(sub(c, p), sub(c, p)) < R * R) out.push(t / 3); }
  return Int32Array.from(out); }
// first hit distance (> tmin) of the ray o + s d on the listed triangles (Moller-Trumbore, both faces), Infinity if none
export function rayHit(X, T, list, o, d, tmin = 0) { let best = Infinity;
  for (const t of list) { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    const e1 = [X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]], e2 = [X[c * 3] - X[a * 3], X[c * 3 + 1] - X[a * 3 + 1], X[c * 3 + 2] - X[a * 3 + 2]];
    const p = crs(d, e2), det = dot(e1, p); if (Math.abs(det) < 1e-14) continue; const inv = 1 / det, s = [o[0] - X[a * 3], o[1] - X[a * 3 + 1], o[2] - X[a * 3 + 2]], u = dot(s, p) * inv; if (u < 0 || u > 1) continue;
    const q = crs(s, e1), v = dot(d, q) * inv; if (v < 0 || u + v > 1) continue; const h = dot(e2, q) * inv; if (h > tmin && h < best) best = h; }
  return best; }
const med = A => { const B = A.filter(x => x != null && Number.isFinite(x)).sort((p, q) => p - q); return B.length ? B[(B.length - 1) >> 1] * 0.5 + B[B.length >> 1] * 0.5 : null; };
function hull2(P) { const Q = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of Q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = Q.length - 1; i >= 0; i--) { const p = Q[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const H = lo.slice(0, -1).concat(up.slice(0, -1)); let L = 0; for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }

export function armFrame(J, sd) {
  const S = J['shoulder' + sd], E = J['elbow' + sd], a = nrm(sub(E, S)), Lu = Math.hypot(...sub(E, S)), mid = [(J.shoulderL[0] + J.shoulderR[0]) / 2, (J.shoulderL[1] + J.shoulderR[1]) / 2, (J.shoulderL[2] + J.shoulderR[2]) / 2];
  const out = sub(S, mid); out[1] = 0; const lat = perp(out, a); let fwd = nrm(crs(a, lat)); if (fwd[2] < 0) fwd = [-fwd[0], -fwd[1], -fwd[2]];
  return { S, E, a, Lu, lat, fwd, dirAt: deg => { const r = deg * Math.PI / 180; return nrm([lat[0] * Math.cos(r) + fwd[0] * Math.sin(r), lat[1] * Math.cos(r) + fwd[1] * Math.sin(r), lat[2] * Math.cos(r) + fwd[2] * Math.sin(r)]); } };
}

// the body's vertices that belong to one arm (skin weight > 0.5 on that side's upper arm, forearm, hand bones): the arm's own section
export function armSkin(body, sd) { if (!body.SI || !body.bones) return null; const key = '_arm9' + sd; if (body[key]) return body[key];
  const re = new RegExp(`(upperarm|lowerarm|wrist|hand|finger|thumb|index|middle|ring|pinky|metacarpal)[^.]*\\.${sd}$`), isA = body.bones.map(nm => re.test(nm)), n = body.X.length / 3, m = new Uint8Array(n);
  for (let v = 0; v < n; v++) { let w = 0; for (let k = 0; k < 4; k++) if (isA[body.SI[v * 4 + k]]) w += body.SW[v * 4 + k]; m[v] = w > 0.5 ? 1 : 0; } return (body[key] = m); }
export function sleeveHang(Xg, Tg, loops, body, J, { stations = [0.15, 0.3, 0.45, 0.6, 0.75], sectors = { top: 0, front: 90, under: 180, back: 270 }, spread = 20, sleeveR = 0.11 } = {}) {
  const out = {};
  for (const sd of ['L', 'R']) { const armV = armSkin(body, sd), F = armFrame(J, sd), E2 = [F.E[0] + F.a[0] * 0.04, F.E[1] + F.a[1] * 0.04, F.E[2] + F.a[2] * 0.04];
    const bL = trisNear(body.X, body.T, F.S, E2, 0.13), gL = trisNear(Xg, Tg, F.S, E2, 0.2), st = [];
    const skinAt = (o, d) => rayHit(body.X, body.T, bL, o, d, 0);
    for (const f of stations) { const o = [F.S[0] + F.a[0] * f * F.Lu, F.S[1] + F.a[1] * f * F.Lu, F.S[2] + F.a[2] * f * F.Lu], row = { t: f };
      for (const [k, deg] of Object.entries(sectors)) { const g = [];
        for (const dd of [-spread, 0, spread]) { const d = F.dirAt(deg + dd), s = skinAt(o, d); if (!Number.isFinite(s)) { g.push(null); continue; } const c = rayHit(Xg, Tg, gL, o, d, Math.max(0, s - 0.01)); g.push(Number.isFinite(c) && c - s < 0.15 ? (c - s) * 1000 : null); }
        const m = med(g); row[k] = m == null ? null : +m.toFixed(1); }
      st.push(row); }
    // the hem ring(s) round this arm
    let hem = null;
    for (const L of loops || []) { if (!L.closed || L.ids.length < 8) continue; let nearN = 0; const P = L.ids.map(w => [Xg[w * 3], Xg[w * 3 + 1], Xg[w * 3 + 2]]);
      for (const p of P) { const v = sub(p, F.S), tt = dot(v, F.a), q = [v[0] - F.a[0] * tt, v[1] - F.a[1] * tt, v[2] - F.a[2] * tt]; if (Math.hypot(...q) < sleeveR && tt > -0.02 && tt < F.Lu * 1.9) nearN++; }
      if (nearN < 0.8 * P.length) continue;
      let tm = 0; for (const p of P) tm += dot(sub(p, F.S), F.a) / P.length; if (hem && hem._tm < tm) continue;   // the loop highest on the arm (a sleeve's own hem, not a cuff's edge below it)
      const o = [F.S[0] + F.a[0] * tm, F.S[1] + F.a[1] * tm, F.S[2] + F.a[2] * tm];
      // girth: the loop projected square to the arm, its own length
      let gl = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], d = sub(q, p), dt = dot(d, F.a); gl += Math.hypot(d[0] - F.a[0] * dt, d[1] - F.a[1] * dt, d[2] - F.a[2] * dt); }
      // the arm's girth there: hull of the body's vertices within 6 mm of the plane, within 9 cm of the axis, on this side of the body's midline
      const pts = []; for (let v = 0; v < body.X.length / 3; v++) { if (armV && !armV[v]) continue; const p = [body.X[v * 3], body.X[v * 3 + 1], body.X[v * 3 + 2]], w = sub(p, F.S), tt = dot(w, F.a); if (Math.abs(tt - tm) > 0.006) continue;
        const q = [w[0] - F.a[0] * tt, w[1] - F.a[1] * tt, w[2] - F.a[2] * tt]; if (Math.hypot(...q) > 0.09) continue; pts.push([dot(q, F.lat), dot(q, F.fwd)]); }
      const ag = pts.length > 8 ? hull2(pts) : null;
      // the gap at the ring's top and under side: loop vertices within 35 degrees of the sector, their radius less the skin's along the same ray
      const gapAt = deg0 => { const g = []; for (const p of P) { const w = sub(p, o), tt = dot(w, F.a), q = [w[0] - F.a[0] * tt, w[1] - F.a[1] * tt, w[2] - F.a[2] * tt], r = Math.hypot(...q);
          const ang = Math.atan2(dot(q, F.fwd), dot(q, F.lat)) * 180 / Math.PI, da = Math.abs(((ang - deg0) % 360 + 540) % 360 - 180); if (da > 35) continue; const s = skinAt(o, nrm(q)); if (Number.isFinite(s)) g.push((r - s) * 1000); }
        const m = med(g); return m == null ? null : +m.toFixed(1); };
      hem = { _tm: tm, t: +(tm / F.Lu).toFixed(3), n: P.length, girthCm: +(gl * 100).toFixed(1), armCm: ag == null ? null : +(ag * 100).toFixed(1), ratio: ag ? +(gl / ag).toFixed(3) : null, top: gapAt(0), under: gapAt(180), front: gapAt(90), back: gapAt(270) }; }
    if (hem) delete hem._tm;
    out[sd] = { upperArmCm: +(F.Lu * 100).toFixed(1), stations: st, hem }; }
  return out;
}
// one line for a table: the median top / under gap over the stations the sleeve covers (and the hem's)
export function hangSummary(H) { const r = {}; for (const sd of ['L', 'R']) { const S = H[sd]; if (!S) continue; const cov = S.stations.filter(x => x.top != null || x.under != null);
    r[sd] = { top: med(cov.map(x => x.top)), under: med(cov.map(x => x.under)), front: med(cov.map(x => x.front)), back: med(cov.map(x => x.back)), covered: cov.length, hemTop: S.hem?.top ?? null, hemUnder: S.hem?.under ?? null, ratio: S.hem?.ratio ?? null, hemT: S.hem?.t ?? null }; }
  return r; }

// rev 3 (iteration 3): THE FOREARM-HANG RULER. The forearm's own frame: a = elbow -> wrist; the TOP is the side gravity lays the cloth
// on: against h = gravity made square to the forearm, a little (hangBias) toward the body (settle9's hang direction, so the ruler and
// the settle read one 'top'). A relaxed forearm leans 10-15 deg off vertical (wrist ahead of the elbow), so |g square to it| is 0.17-0.26
// of g and the top is the front-lateral side (28-45 deg from lateral toward the front on L03 / L05), not the lateral side.
// Stations t = 0.15 .. 0.75 of the elbow -> wrist length (above the cuff), and the CUFF station 0.9; rays from the axis at top / side1 /
// under / side2 (+-20 deg, median of three); gap = cloth - skin (mm); null = no cloth within 15 cm (a short or pushed-up sleeve).
//   foreHang(Xg, Tg, body, J, { stations, cuff }) -> { L: { tiltDeg, gPerp, topDeg, stations: [...], cuff: {...} }, R: ... }
export function foreFrame(J, sd, hangBias = 0.1) {
  const E = J['elbow' + sd], W = J['wrist' + sd], S = J['shoulder' + sd], a = nrm(sub(W, E)), Lf = Math.hypot(...sub(W, E));
  const mid = [(J.shoulderL[0] + J.shoulderR[0]) / 2, 0, (J.shoulderL[2] + J.shoulderR[2]) / 2], o = sub([S[0], 0, S[2]], mid), lat = perp(o, a);
  let fwd = nrm(crs(a, lat)); if (fwd[2] < 0) fwd = [-fwd[0], -fwd[1], -fwd[2]];
  const gp = [a[0] * a[1], -1 + a[1] * a[1], a[2] * a[1]], h = nrm([gp[0] - hangBias * lat[0], gp[1] - hangBias * lat[1], gp[2] - hangBias * lat[2]]), top = perp([-h[0], -h[1], -h[2]], a);
  const side = nrm(crs(a, top));
  return { E, W, a, Lf, lat, fwd, top, side, tiltDeg: Math.acos(Math.max(-1, Math.min(1, -a[1]))) * 180 / Math.PI, gPerp: Math.hypot(...gp), topDeg: Math.round(Math.atan2(dot(top, fwd), dot(top, lat)) * 180 / Math.PI),
    dirAt: deg => { const r = deg * Math.PI / 180; return nrm([top[0] * Math.cos(r) + side[0] * Math.sin(r), top[1] * Math.cos(r) + side[1] * Math.sin(r), top[2] * Math.cos(r) + side[2] * Math.sin(r)]); } };
}
export function foreHang(Xg, Tg, body, J, { stations = [0.15, 0.3, 0.45, 0.6, 0.75], cuff = 0.9, sectors = { top: 0, side1: 90, under: 180, side2: 270 }, spread = 20, hangBias = 0.1 } = {}) {
  const out = {};
  for (const sd of ['L', 'R']) { const F = foreFrame(J, sd, hangBias), W2 = [F.W[0] + F.a[0] * 0.05, F.W[1] + F.a[1] * 0.05, F.W[2] + F.a[2] * 0.05];
    const bL = trisNear(body.X, body.T, F.E, W2, 0.13), gL = trisNear(Xg, Tg, F.E, W2, 0.2);
    const row = f => { const o = [F.E[0] + F.a[0] * f * F.Lf, F.E[1] + F.a[1] * f * F.Lf, F.E[2] + F.a[2] * f * F.Lf], r = { t: f };
      for (const [k, deg] of Object.entries(sectors)) { const g = [];
        for (const dd of [-spread, 0, spread]) { const d = F.dirAt(deg + dd), s = rayHit(body.X, body.T, bL, o, d, 0); if (!Number.isFinite(s)) { g.push(null); continue; } const c = rayHit(Xg, Tg, gL, o, d, Math.max(0, s - 0.01)); g.push(Number.isFinite(c) && c - s < 0.15 ? (c - s) * 1000 : null); }
        const m = med(g); r[k] = m == null ? null : +m.toFixed(1); }
      return r; };
    const st = stations.map(row), cov = st.filter(x => x.top != null || x.under != null);
    out[sd] = { forearmCm: +(F.Lf * 100).toFixed(1), tiltDeg: +F.tiltDeg.toFixed(1), gPerp: +F.gPerp.toFixed(2), topDeg: F.topDeg, stations: st, cuff: cuff ? row(cuff) : null,
      top: med(cov.map(x => x.top)), under: med(cov.map(x => x.under)), side1: med(cov.map(x => x.side1)), side2: med(cov.map(x => x.side2)), covered: cov.length }; }
  return out;
}
export function foreSummary(H) { const r = {}; for (const sd of ['L', 'R']) { const S = H[sd]; if (!S || !S.covered) continue; r[sd] = { top: S.top, under: S.under, side1: S.side1, side2: S.side2, covered: S.covered, cuffTop: S.cuff?.top ?? null, cuffUnder: S.cuff?.under ?? null, topDeg: S.topDeg }; } return r; }
