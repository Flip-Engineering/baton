// BODY / MEASURE (HUMAN c8 lane A): anthropometry of a built person, the way NHANES and ANSUR measure people, in bind pose.
// A tape is the convex hull of a plane slice of the body (a tape spans hollows; the 2-D hull perimeter), arms or the other leg left
// out by the mesh's own regions. Definitions follow the survey manuals as closely as a mesh allows:
//   waist  NHANES: horizontal, at the top of the iliac crest (our iliacCrest landmarks); NOT the narrowest level (that is naturalWaist)
//   hip    NHANES: horizontal, at the maximum posterior extension of the buttocks
//   bust   ANSUR chest circumference: horizontal at the bust point (women) / nipples (men); underbust: the least tape just below
//   muac   NHANES mid-upper-arm: perpendicular to the upper arm at the acromion-olecranon midpoint
//   thigh  ANSUR: perpendicular to the thigh at the gluteal furrow; calf: the greatest, perpendicular to the shank
//   biacromial (acromion landmarks, minus skin), bicristal (iliac crests, minus the soft tissue a caliper compresses: 12 mm + depot
//   fat), hipBreadth (greatest breadth over the hips), crotch height (lowest midline point), sitting height ~ stature - crotch height
//   (ANSUR: the two agree within a few mm on average), head circumference (greatest horizontal tape above the brows), neck (least
//   tape between C7 and the jaw).
//   mass from the closed mesh's volume: (V - residual lung volume) x body density, the density from the person's fat fraction by
//   the two-compartment model (Siri 1961: fat 0.9007, fat-free 1.100 kg/L). The per-segment masses are kin.js's job.
//   FFIT (Simmons, Istook and Devarajan 2004) on bust, natural waist, hip and high hip, in inches.
// measure(S, built, { pf }) -> { stature, mass, bmi, waist, naturalWaist, highHip, hip, bust, underbust, muac, thigh, calf, biacromial, bicristal,
//   hipBreadth, crotch, sitting, headCirc, neck, heads, apexHeads, whr, whrNatural, whtr, ffit, breastVolMl, vol, levels }  (metres, kg, litres)
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
function hull2(pts) {
  if (pts.length < 3) return 0;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1)); let L = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; L += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return L;
}
// triangle sets by region (all three vertices in the set), cached on the studio
export function triSet(S, regs) {
  const key = 'tri:' + regs.join(','); S._tris ||= {}; if (S._tris[key]) return S._tris[key];
  const t = S.tri, R = S.region, ok = new Set(regs), out = [];
  for (let i = 0; i < t.length; i += 3) if (ok.has(R[t[i]]) && ok.has(R[t[i + 1]]) && ok.has(R[t[i + 2]])) out.push(i);
  return (S._tris[key] = Int32Array.from(out));
}
// plane slice: points in the plane's 2-D frame (u, v); side: keep only points with sign(x) == side (0 = both)
export function slicePlane(S, P, tris, p0, n, side = 0) {
  const t = S.tri, a0 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [n[1] * a0[2] - n[2] * a0[1], n[2] * a0[0] - n[0] * a0[2], n[0] * a0[1] - n[1] * a0[0]]; const ul = Math.hypot(...u); u = u.map(x => x / ul);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]], out = [];
  const d = i => (P[i * 3] - p0[0]) * n[0] + (P[i * 3 + 1] - p0[1]) * n[1] + (P[i * 3 + 2] - p0[2]) * n[2];
  for (const k of tris) { const ia = t[k], ib = t[k + 1], ic = t[k + 2], da = d(ia), db = d(ib), dc = d(ic);
    if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
    for (const [i, j, di, dj] of [[ia, ib, da, db], [ib, ic, db, dc], [ic, ia, dc, da]]) { if (di * dj >= 0) continue; const s = di / (di - dj);
      const x = P[i * 3] + (P[j * 3] - P[i * 3]) * s, y = P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * s, z = P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * s;
      if (side && Math.sign(x) !== side) continue;
      const q = [x - p0[0], y - p0[1], z - p0[2]]; out.push([q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * v[0] + q[1] * v[1] + q[2] * v[2], x]); } }
  return out;
}
export const tapeAt = (S, P, tris, p0, n, side = 0) => hull2(slicePlane(S, P, tris, p0, n, side).map(q => [q[0], q[1]]));
const hz = y => [[0, y, 0], [0, 1, 0]];
export function volume(S, P) {
  const t = S.tri; let v = 0;
  for (let i = 0; i < t.length; i += 3) { const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
  return Math.abs(v) / 6;
}
export const siriDensity = pf => 1 / (pf / 0.9007 + (1 - pf) / 1.1);       // kg/L
export const residualLung = (sex, H, age = 40) => (sex === 'f' ? 1.05 : 1.3) * (H / (sex === 'f' ? 1.62 : 1.76)) ** 3 * (1 + 0.006 * Math.max(0, age - 30));   // L, RV rises with age
export function ffit(B, W, H, HH) {             // inches; Simmons, Istook and Devarajan 2004 (as the women critic's tools)
  const bh = B - H, hb = H - B, bw = B - W, hw = H - W, r = HH / W;
  if (bh <= 1 && hb < 3.6 && (bw >= 9 || hw >= 10)) return 'hourglass';
  if (hb >= 3.6 && hb < 10 && hw >= 9 && r < 1.193) return 'bottom hourglass';
  if (bh > 1 && bh < 10 && bw >= 9) return 'top hourglass';
  if (hb > 2 && hw >= 7 && r >= 1.193) return 'spoon';
  if (hb >= 3.6 && hw < 9) return 'triangle';
  if (bh >= 3.6 && bw < 9) return 'inverted triangle';
  if (Math.abs(hb) < 3.6 && bw < 9 && hw < 10) return 'rectangle';
  return 'other';
}
const lmP = (S, P, k) => { const v = S.landmarks[k]; return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; };
// the frame's own measures are taken on the mesh BEFORE soft tissue (build().pre): biacromial and bicristal are caliper measures on bone,
// the crotch height and the hip level should not jump when a depot moves a vertex. (pre has the body vertices only.)
export function measure(S, B, { sex = 'f', pf = 0.3, age = 40, quick = false } = {}) {
  const P = B.pos, nb = S.nb, L = k => lmP(S, P, k), H = B.stature, J = (name, end = 'head') => B[end === 'head' ? 'heads' : 'tails'][S.hero.meta.bones.findIndex(b => b.name === name)];
  const trunk = triSet(S, [1, 2, 7]), pelvisLegs = triSet(S, [2, 7, 8]), uarm = triSet(S, [3]), thighT = triSet(S, [7, 8]), shin = triSet(S, [9]), head = triSet(S, [0, 11]), neck = triSet(S, [1, 0, 11, 2]);
  const m = { stature: H, levels: {} };
  const yC = (L('iliacCrestL')[1] + L('iliacCrestR')[1]) / 2, yX = L('xiphoid')[1] - 0.02;
  m.waist = tapeAt(S, P, trunk, ...hz(yC)); m.levels.waist = yC;
  let nw = Infinity, ynw = yC; for (let y = yC + 0.02; y <= yX; y += quick ? 0.015 : 0.0075) { const g = tapeAt(S, P, trunk, ...hz(y)); if (g > 0.3 && g < nw) { nw = g; ynw = y; } }
  m.naturalWaist = nw; m.levels.naturalWaist = ynw;
  // crotch: the lowest point of the trunk near the midline
  const Q = B.pre || P; let yc = Infinity, ycT = Infinity; for (let v = 0; v < nb; v++) { const r = S.region[v]; if ((r === 7 || r === 2) && Math.abs(Q[v * 3]) < 0.012 * H / 1.7) { yc = Math.min(yc, Q[v * 3 + 1]); ycT = Math.min(ycT, P[v * 3 + 1]); } }
  m.crotch = yc; m.crotchSkin = ycT; m.sitting = H - yc;
  // hip: at the greatest posterior protrusion of the buttocks
  let zmin = Infinity, yh = (yc + yC) / 2; for (let v = 0; v < nb; v++) { const r = S.region[v], y = Q[v * 3 + 1]; if ((r === 7 || r === 8) && y > yc && y < yC - 0.02 && Q[v * 3 + 2] < zmin) { zmin = Q[v * 3 + 2]; yh = y; } }
  m.hip = tapeAt(S, P, pelvisLegs, ...hz(yh)); m.levels.hip = yh;
  if (!quick) { m.highHip = tapeAt(S, P, pelvisLegs, ...hz((ynw + yh) / 2)); m.levels.highHip = (ynw + yh) / 2; }
  if (!quick) { let g = 0; for (let y = yc + 0.03; y < yC; y += 0.01) g = Math.max(g, tapeAt(S, P, pelvisLegs, ...hz(y))); m.hipMax = g; }
  { let xb = 0; for (let y = yc; y < yC; y += quick ? 0.02 : 0.01) { const q = slicePlane(S, P, thighT, ...hz(y)); if (q.length) { let a = Infinity, b = -Infinity; for (const p of q) { a = Math.min(a, p[2]); b = Math.max(b, p[2]); } xb = Math.max(xb, b - a); } } m.hipBreadth = xb; }
  // P1 (3 Oct): ANSUR II's depths and breadths a caliper takes horizontally: buttock depth at the buttock's greatest posterior protrusion
  // (the hip level), waist depth and breadth at the omphalion (ANSUR's waist level); x is the body's breadth, z its depth
  { const ext = (tris, y) => { let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;      // a horizontal slice's (u, v) = (-z, -x)
      for (const q of slicePlane(S, P, tris, ...hz(y))) { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); }
      return { depth: u1 - u0, breadth: v1 - v0 }; };
    const yo = L('omphalion')[1], w = ext(trunk, yo), b = ext(pelvisLegs, yh);
    m.waistDepth = w.depth; m.waistBreadth = w.breadth; m.buttockDepth = b.depth; m.levels.omphalion = yo; }
  // bust / chest at the bust point (the most forward point of the chest between the xiphoid and the notch, off the midline)
  const yS = L('suprasternale')[1]; let za = -Infinity, yb = (yX + yS) / 2, va = -1;
  for (let v = 0; v < nb; v++) { const r = S.region[v], x = Math.abs(P[v * 3]), y = P[v * 3 + 1]; if (r === 2 && x > 0.03 * H / 1.7 && x < 0.16 * H / 1.7 && y > yX - 0.08 && y < yS && P[v * 3 + 2] > za) { za = P[v * 3 + 2]; yb = y; va = v; } }
  const ynip = (L('nippleL')[1] + L('nippleR')[1]) / 2; m.bust = tapeAt(S, P, trunk, ...hz(ynip)); m.levels.bust = ynip; m.apexVertex = va; m.apexY = yb;
  if (!quick) m.bustMax = tapeAt(S, P, trunk, ...hz(yb));
  let ub = Infinity; if (!quick) for (let y = yb - 0.025; y > yb - 0.10 * H / 1.62 && y > ynw + 0.03; y -= 0.008) ub = Math.min(ub, tapeAt(S, P, trunk, ...hz(y))); m.underbust = ub;
  // mid upper arm (left), thigh at the gluteal furrow (left), calf (left)
  const sh = J('upperarm01.L'), el = J('lowerarm01.L'), ac = L('acromionL'), ol = L('olecranonL'), ax = el.map((x, i) => x - sh[i]), al = Math.hypot(...ax), an = ax.map(x => x / al);
  const mid = ac.map((x, i) => (x + ol[i]) / 2); m.muac = tapeAt(S, P, uarm, mid, an, 1);
  const hj = J('upperleg01.L'), kn = J('lowerleg01.L'), an2 = (k => k.map(x => x / Math.hypot(...k)))(kn.map((x, i) => x - hj[i]));
  m.thigh = tapeAt(S, P, thighT, L('gluteFoldL'), an2, 1);
  const ak = J('foot.L'), sv = ak.map((x, i) => x - kn[i]), sl = Math.hypot(...sv), sn = sv.map(x => x / sl); let cf = 0;
  if (!quick) for (let f = 0.12; f <= 0.5; f += 0.04) cf = Math.max(cf, tapeAt(S, P, shin, kn.map((x, i) => x + sv[i] * f), sn, 1)); m.calf = cf;
  // breadths
  const T = B.T, tc = (T[S.landmarks.iliacCrestL] + T[S.landmarks.iliacCrestR]) / 2;
  const LQ = k => lmP(S, Q, k);
  m.biacromial = Math.hypot(...LQ('acromionL').map((x, i) => x - LQ('acromionR')[i])) - 0.01;
  m.bicristal = Math.abs(L('iliacCrestL')[0] - L('iliacCrestR')[0]) - 2 * (0.004 + 0.5 * tc);   // the caliper presses through about half the fat over the crest (an assumption)
  // head and neck
  let ey = 0; for (let k = 0; k < B.eyes.length / 3; k++) ey += B.eyes[k * 3 + 1]; ey /= B.eyes.length / 3;
  let hc = 0; for (let y = ey + 0.012; y < ey + 0.06; y += 0.006) hc = Math.max(hc, tapeAt(S, P, head, ...hz(y))); m.headCirc = hc;
  const yv = L('vertex')[1], ymen = L('menton')[1]; m.headHeight = yv - ymen; m.heads = H / m.headHeight; m.apexHeads = (yv - yb) / m.headHeight;
  let nk = Infinity; const y7 = L('cervicale')[1], yg = (L('gonionL')[1] + L('gonionR')[1]) / 2;
  if (!quick) for (let y = Math.min(y7, yg) + 0.005; y < Math.max(y7, yg); y += 0.006) { const g = tapeAt(S, P, triSet(S, [1]), ...hz(y)); if (g > 0.15) nk = Math.min(nk, g); } m.neck = isFinite(nk) ? nk : null;
  // volume and mass
  m.vol = volume(S, P) * 1000; m.density = siriDensity(pf); m.rv = residualLung(sex, H, age);
  m.mass = (m.vol - m.rv) * m.density; m.bmi = m.mass / (H * H);
  m.whr = m.waist / m.hip; m.whrNatural = m.naturalWaist / m.hip; m.whtr = m.waist / H;
  const inch = x => x / 0.0254; if (!quick) m.ffit = ffit(inch(m.bust), inch(m.naturalWaist), inch(m.hip), inch(m.highHip));
  m.skinfoldProxy = { tricepsT: T[S.landmarks.olecranonL] * 0 + sampleT(S, T, 'tricepsFat'), subscapT: sampleT(S, T, 'back') };
  return m;
}
// the depot thickness at a field's peak (the skinfold sites: triceps = the tricepsFat peak, subscapular = the back depot's peak)
function sampleT(S, T, field) { const f = S.field(field); let b = -1, v0 = 0; for (let i = 0; i < f.ix.length; i++) if (f.f[i] > b && f.ix[i] < S.nb) { b = f.f[i]; v0 = f.ix[i]; } return T[v0]; }
// the chest wall under the breast, for the support model (supported(): the bust in a bra) and the bench: inside the footprint the wall
// is the surface relaxed to a membrane with its rim fixed. (The breast VOLUME is measured in person.js as a mesh-volume difference
// against the same person with MakeHuman's smallest cup and no mound, plus that small breast's own ~100 mL: a membrane over a
// curved ribcage counts the ribcage's own convexity, ~0.2 L.): inside the footprint the wall is the surface relaxed to a minimal (Laplacian) membrane with
// its rim fixed; the breast is what stands proud of it (per breast, mL)
export function breastVolume(S, B, out = null) {
  const P = B.pos, fp = S.field('breastFoot'), nb = S.nb; if (!fp) return 0;
  S._bw ||= (() => { const inside = new Uint8Array(nb), ids = []; for (let i = 0; i < fp.ix.length; i++) if (fp.f[i] > 0.08 && fp.ix[i] < nb) { inside[fp.ix[i]] = 1; ids.push(fp.ix[i]); } return { inside, ids }; })();
  const { inside, ids } = S._bw, W = new Float32Array(P.subarray(0, nb * 3)), off = S._topo.off, nbr = S._topo.nbr;
  for (let it = 0; it < 160; it++) for (const v of ids) { let x = 0, y = 0, z = 0, k = 0; for (let j = off[v]; j < off[v + 1]; j++) { const u = nbr[j]; x += W[u * 3]; y += W[u * 3 + 1]; z += W[u * 3 + 2]; k++; } W[v * 3] = x / k; W[v * 3 + 1] = y / k; W[v * 3 + 2] = z / k; }
  // vertex areas
  const t = S.tri, A = S._vA = S._vA || new Float32Array(nb); A.fill(0);
  for (let i = 0; i < t.length; i += 3) { const a = t[i], b = t[i + 1], c = t[i + 2]; if (!inside[a] && !inside[b] && !inside[c]) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3; A[a] += ar; A[b] += ar; A[c] += ar; }
  let vol = 0; const h = out ? new Float32Array(nb) : null;
  for (const v of ids) { const N = B.N, d = (P[v * 3] - W[v * 3]) * N[v * 3] + (P[v * 3 + 1] - W[v * 3 + 1]) * N[v * 3 + 1] + (P[v * 3 + 2] - W[v * 3 + 2]) * N[v * 3 + 2]; if (d > 0) vol += d * A[v]; if (h) h[v] = d; }
  if (out) { out.wall = W; out.h = h; out.ids = ids; }
  return vol / 2 * 1e6;      // two breasts -> one, m^3 -> mL
}
