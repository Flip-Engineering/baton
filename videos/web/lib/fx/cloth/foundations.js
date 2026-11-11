// FOUNDATIONS (CLOTHING c2, K3): real underwear as the base layer of the stack. Bras (soft cup, structured underwire, sports) that
// RESHAPE the bust as support does (lift, shape, separation: lane A's breast terms, read-only), briefs for women, briefs and boxer
// briefs for men, undershirts (an A-shirt tank, a crew tee). Made to measure on the person's own (supported) body. Opt-in: nothing
// existing imports this file; a hero that never wears a foundation renders exactly as before.
//
// Method. Underwear is worn under TENSION (negative ease, elastic knits and bands): it does not drape, it is stretched over the body
// and bridges its hollows. So a foundation here is a TENSION SHELL, not a draped garment: the region of the (supported) body it covers,
// cut by a smooth outline (a level set on the body, made from the person's landmarks: the inframammary fold, the apex, the axilla,
// the navel, the iliac crest, the gluteal fold, the crotch), subdivided once with Phong midpoints (1-1.5 cm edges on a 2-3 cm body),
// then relaxed as a membrane under tension (umbrella steps = area minimisation) that may not pass inside the body plus its own
// thickness, with its elastic edges (and, for an underwire bra, the wire line in the fold and the centre gore) held on the body. A
// structured cup relaxes longest (moulded foam: smooth, no nipple), a soft cup least; a sports bra holds nothing at the centre, so it
// bridges the cleavage (compression: lane A's 'sports' term); briefs bridge the fork and the cleft; an undershirt bridges the sternum
// and the spine. Every edge then gets a BINDING (an elastic trim swept round the edge: the garment's inside never shows at its edge).
// FreeSewing has Bruce (boxer briefs) and Aaron (an A-shirt) but no bra; its drafts assume a drape with ease, which a garment worn at
// -5..-15 % ease is not, so all foundations here are ours (review/studio_clothing_c2/after/foundations/NOTES.md).
//
//   import { supportedData, wearFoundations, FOUNDATION_KINDS } from '/web/lib/fx/cloth/foundations.js'
//   const data = supportedData(p, 'structured')                // a lane A person with the bust in that bra (hero data, like p.withSupport)
//   const h = new Hero(data, { variant: data.meta.variants[0].name, ... })
//   const F = wearFoundations(h, p, [{ id: 'bra', kind: 'bra.structured', color: '#e9e4da' }, { id: 'briefs', kind: 'briefs', color: '#e9e4da' }])
//   // F.list: [{ id, kind, mesh, bindings, data (plain arrays: bake / export), report }]; h._found (stack.js reads it: design 'found.<kind>')
//   // F.cover: Uint8Array per body vertex (1 = under a foundation, away from its edges) for the skin cull (finish.js coverSkin)
import { SurfaceMesh, vertexNormals } from './collide.js';
import { build } from '../body/mix.js';
import { SUPPORTS } from '../body/person.js';
export const FOUNDATIONS_VERSION = 1;
// CLOTH8 (round 7, opt-in; all off = every foundation exactly as before): the full-size Cycles read of the v5 underwear (review/
// studio_human_c8/gpu_cycles: the bra's strap ends sat on the cups as loose tabs; the briefs clung to the crotch, the form printing
// through; skin showed at the waistband's edge). setFound8({ strapSew: true, bridge: 0.006, edgeCover: 1 }) once (the integrator's
// makePerson, a lab), or a spec's opts.f8 per foundation:
//   strapSew   the strap's front end sewn INTO the cup's top edge (it ends 2.5 mm under the edge, under the binding, its last 12 mm
//              flattening into the cup) instead of lying 1.8 cm down the cup as a ribbon over it
//   bridge     briefs / boxers: the shell over the fork and the front below the navel lifted as a membrane over the hollows (a height
//              field along the body's normal, never lower than the fit, at most `bridge` m): stretched jersey bridges the cleft, it
//              does not follow it
//   edgeCover  the skin under the shell culled from `edgeCover` rings from its edges (default 2): under the binding no skin is drawn to
//              come through it
//   cupLift    bras: the cup over the apex lifted the same way (a molded cup is a smooth dome; the nipples' detail printed through it
//              as crumpled bumps), at most `cupLift` m, within 4.5 cm of each apex
export const FOUND8 = { strapSew: false, bridge: 0, edgeCover: 2, cupLift: 0 };
export function setFound8(o = {}) { Object.assign(FOUND8, o); return FOUND8; }
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const now = () => (globalThis.performance ? performance.now() : Date.now());
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------------------------------------------------------- the catalogue
// thick: the garment's thickness (m; cups of moulded foam are thicker than the band); its: membrane relaxation steps (the tension);
// fabric: fabrics.js name; binding: the elastic trim's width (m) and thickness; holds: what besides the edges is held on the body
export const FOUNDATION_KINDS = {
  'bra.soft':       { part: 'bra', sex: 'f', support: 'soft', thick: 0.0016, cupThick: 0.0022, its: 80, fabric: 'jersey', bind: [0.007, 0.0012], holds: ['gore'], label: 'soft-cup bra (wireless, lined)' },
  'bra.structured': { part: 'bra', sex: 'f', support: 'structured', thick: 0.0016, cupThick: 0.0035, its: 140, fabric: 'jersey', bind: [0.007, 0.0012], holds: ['gore', 'wire'], label: 'underwire bra (moulded cups)' },
  'bra.sports':     { part: 'bra', sex: 'f', support: 'sports', thick: 0.0024, cupThick: 0.0026, its: 160, fabric: 'jersey', bind: [0.010, 0.0015], holds: [], label: 'sports bra (compression, one piece)' },
  'briefs':         { part: 'briefs', sex: 'f', thick: 0.0010, its: 70, fabric: 'jersey', bind: [0.008, 0.0012], waistBind: 0.010, label: 'full briefs (cotton jersey)' },
  'briefs.m':       { part: 'briefs', sex: 'm', thick: 0.0012, its: 70, fabric: 'jersey', bind: [0.008, 0.0013], waistBind: 0.028, label: 'men\'s briefs (cotton jersey, elastic waistband)' },
  'boxers.m':       { part: 'boxers', sex: 'm', thick: 0.0012, its: 60, fabric: 'jersey', bind: [0.009, 0.0013], waistBind: 0.030, label: 'boxer briefs (cotton-elastane jersey)' },
  'undershirt.tank':{ part: 'tank', sex: 'm', thick: 0.0011, its: 40, fabric: 'rib', bind: [0.008, 0.0012], label: 'A-shirt undershirt (1x1 rib)' },
  'undershirt.crew':{ part: 'tee', sex: 'm', thick: 0.0009, its: 30, fabric: 'jersey', bind: [0.012, 0.0012], label: 'crew-neck undershirt (jersey)' },
};
// the bust in each bra (lane A's breast terms: lift = sag taken out, trans = the volume moved up and in, point, volVert; compress for
// a compression bra). 'structured' is ours: a modern moulded underwire cup (lift nearly full, rounder than lane A's 1940s 'period')
export const BRA_SUPPORT = { soft: 'soft', structured: { lift: 0.95, trans: 0.28, point: 0.1, volVert: 0.15, compress: 1 }, sports: 'sports' };

// ---------------------------------------------------------------- support: the bust in a bra
export function supportPositions(p, bra) {
  if (!p || p.sex !== 'f' || !bra) return null; const k = BRA_SUPPORT[bra] ?? bra;
  if (typeof k === 'string') return SUPPORTS[k] ? p.supported(k) : null;
  if (p.priorVA || !p.params?.breast) return p.supported ? p.supported('soft') : null;   // a prior body: lane A's own approximation
  const S = p._S, q = p.params, sh = q.breastShape || {};
  const pr = { ...q, breast: { ...q.breast, sag: (q.breast.sag || 0) * (1 - k.lift) }, breastShape: { ...sh, trans: (sh.trans || 0) + k.trans, point: (sh.point || 0) + k.point, volVert: Math.max(0, (sh.volVert || 0) + k.volVert) }, laxity: q.laxity };
  return new Float32Array(build(S, pr).pos);
}
// hero data with the bust in that bra (as lane A's p.withSupport; the person's own record is not changed)
// dome (CLOTH3, opt-in): the supported bust shaped as a CUP shapes it: the breast's footprint smoothed (Taubin, volume kept) so the
// apex rounds into a dome instead of lane A's cone (the 1950s bullet the c8 judge saw in the cups and under every shirt)
export function supportedData(p, bra, { dome = false } = {}) {
  let P2 = supportPositions(p, bra); if (!P2) return p; if (dome) P2 = domeBust(p, P2, typeof dome === 'object' ? dome : {}); const nm = `${p.name}_k3${bra}`, V2 = { ...p.meta.variants[0], name: nm }, ex = new Map([['pos_' + nm, P2], ['eyes_' + nm, p.built.eyes]]);
  return { ...p, name: nm, meta: { ...p.meta, variants: [V2] }, arr: k => (ex.has(k) ? ex.get(k) : p._S.hero.arr(k)), support: bra, supportPos: P2 };
}

// CLOTH3: the bust domed in its cup. Over lane A's breast footprint (breastFoot, 0..1), Taubin smoothing (lambda / mu, which keeps the
// volume where plain Laplacian smoothing shrinks it) weighted by the footprint: the cone's apex and its ring flatten into a dome, the
// footprint's edge (the chest wall) stays. its 40: the apex rounds over ~5 cm on lane A's 2 cm mesh.
export function domeBust(p, P, { its = 40, lambda = 0.5, mu = -0.53, lo = 0.12, hi = 0.55 } = {}) {
  const S = p._S, nb = S.nb, fl = S.field('breastFoot'); if (!fl) return P; const w = new Float32Array(nb); for (let i = 0; i < fl.ix.length; i++) if (fl.ix[i] < nb) w[fl.ix[i]] = sstep(lo, hi, fl.f[i]);
  const T = []; for (let t = 0; t < S.tri.length; t += 3) if (S.tri[t] < nb && S.tri[t + 1] < nb && S.tri[t + 2] < nb) T.push(S.tri[t], S.tri[t + 1], S.tri[t + 2]);
  const nbr = neighbours(T, nb), X = Float64Array.from(P.subarray(0, nb * 3)), Y = new Float64Array(nb * 3), step = (A, B, k) => { for (let v = 0; v < nb; v++) { const L = nbr[v]; if (!w[v] || !L.length) { for (let c = 0; c < 3; c++) B[v * 3 + c] = A[v * 3 + c]; continue; }
      for (let c = 0; c < 3; c++) { let m = 0; for (const u of L) m += A[u * 3 + c]; B[v * 3 + c] = A[v * 3 + c] + k * w[v] * (m / L.length - A[v * 3 + c]); } } };
  for (let it = 0; it < its; it++) { step(X, Y, lambda); step(Y, X, mu); }
  const out = Float32Array.from(P); for (let i = 0; i < nb * 3; i++) out[i] = X[i]; return out;
}

// ---------------------------------------------------------------- the body, in metres, bind (the A-pose)
export function heroScale(h) { h.group.updateMatrixWorld(true); const e = h.body.matrixWorld.elements, g = h.group.matrixWorld.elements;
  const det = m => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]); return Math.cbrt(det(e) / det(g)); }
export function bodyOf(p, P, h = null) {
  const S = p._S, nb = S.nb, T = [], src = h ? h.body.geometry.index.array : S.tri;
  for (let t = 0; t < src.length; t += 3) if (src[t] < nb && src[t + 1] < nb && src[t + 2] < nb) T.push(src[t], src[t + 1], src[t + 2]);
  const X = new Float64Array(nb * 3); for (let i = 0; i < nb * 3; i++) X[i] = P[i];
  const tris = Int32Array.from(T); let N = vertexNormals(X, tris);
  const L = k => { const v = S.landmarks[k]; return [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]; };
  { const v = S.landmarks.suprasternale; if (N[v * 3 + 2] < 0) { for (let i = 0; i < tris.length; i += 3) { const b = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = b; } N = vertexNormals(X, tris); } }
  const region = S.region;
  // the torso's centre (z) per 1 cm of height: midway between its front and back on the midline (|x| < 4 cm)
  let y0 = Infinity, y1 = -Infinity; for (let v = 0; v < nb; v++) if (region[v] === 2 || region[v] === 7) { y0 = Math.min(y0, X[v * 3 + 1]); y1 = Math.max(y1, X[v * 3 + 1]); }
  const nbin = Math.ceil((y1 - y0) / 0.01) + 1, zf = new Float64Array(nbin).fill(-Infinity), zb = new Float64Array(nbin).fill(Infinity);
  for (let v = 0; v < nb; v++) { if (!(region[v] === 2 || region[v] === 7 || region[v] === 1) || Math.abs(X[v * 3]) > 0.04) continue; const k = Math.round((X[v * 3 + 1] - y0) / 0.01); if (k < 0 || k >= nbin) continue; zf[k] = Math.max(zf[k], X[v * 3 + 2]); zb[k] = Math.min(zb[k], X[v * 3 + 2]); }
  // a bin is valid when it holds both the front and the back (a 2 cm mesh leaves 1 cm bins with only one side): a +-2 cm window
  const zcB = new Float64Array(nbin), ok = new Uint8Array(nbin);
  for (let k = 0; k < nbin; k++) { let a = -Infinity, b = Infinity; for (let j = Math.max(0, k - 2); j <= Math.min(nbin - 1, k + 2); j++) { a = Math.max(a, zf[j]); b = Math.min(b, zb[j]); } if (isFinite(a) && isFinite(b) && a - b > 0.08) { zcB[k] = (a + b) / 2; ok[k] = 1; } }
  { let last = null; for (let k = 0; k < nbin; k++) { if (ok[k]) last = zcB[k]; else if (last != null) zcB[k] = last; } let nxt = null; for (let k = nbin - 1; k >= 0; k--) { if (ok[k]) nxt = zcB[k]; else if (!ok[k] && (k === 0 || !isFinite(zcB[k]) || zcB[k] === 0) && nxt != null) zcB[k] = nxt; } }
  for (let it = 0; it < 3; it++) { const c = Float64Array.from(zcB); for (let k = 1; k + 1 < nbin; k++) zcB[k] = (c[k - 1] + 2 * c[k] + c[k + 1]) / 4; }
  const zc = y => zcB[clamp(Math.round((y - y0) / 0.01), 0, nbin - 1)];
  const theta = (x, y, z) => Math.atan2(x, z - zc(y));
  return { S, p, nb, X, tris, N, region, L, zc, theta, kin: p.kin };
}

// ---------------------------------------------------------------- outlines: a signed function per garment (> 0 inside), on positions
// knots [[|theta|, y], ...] -> a smooth y(|theta|) (smoothstep between knots)
const curve = K => a => { a = Math.abs(a); if (a <= K[0][0]) return K[0][1]; for (let i = 0; i + 1 < K.length; i++) if (a <= K[i + 1][0]) { const t = sstep(K[i][0], K[i + 1][0], a); return K[i][1] + (K[i + 1][1] - K[i][1]) * t; } return K[K.length - 1][1]; };
// distance from p to a polyline (array of [x,y,z])
function distPoly(Pl, x, y, z) { let best = Infinity; for (let i = 0; i + 1 < Pl.length; i++) { const a = Pl[i], b = Pl[i + 1], ab = sub(b, a), ap = [x - a[0], y - a[1], z - a[2]], t = clamp(dot(ap, ab) / (dot(ab, ab) || 1)), d = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t); if (d < best) best = d; } return best; }
// a strap's path over the shoulder: rays cast toward a line along x through the shoulder (height yc, depth zc), at angles phi in the
// y-z plane from the front anchor up over the top to the back anchor; x eased from the front's to the shoulder's to the back's. The
// first hit from outside is the path (smooth: no snapping to the 2 cm body vertices)
function strapPath(B, front, xs, back, yc, n = 70) {
  const zc = B.zc(yc), xmin = Math.min(front[0], xs, back[0]) - 0.06, xmax = Math.max(front[0], xs, back[0]) + 0.06, T = [];
  for (let t = 0; t < B.tris.length; t += 3) { const a = B.tris[t]; const r = B.region[a]; if (r !== 2 && r !== 1 && r !== 3) continue; const x = B.X[a * 3]; if (x < xmin || x > xmax || B.X[a * 3 + 1] < yc - 0.25) continue; T.push(B.tris[t], B.tris[t + 1], B.tris[t + 2]); }
  const pf = Math.atan2(front[1] - yc, front[2] - zc); let pb = Math.atan2(back[1] - yc, back[2] - zc); if (pb < Math.PI / 2) pb += 2 * Math.PI;
  const X = B.X, hit = (O, D) => { let best = Infinity; for (let t = 0; t < T.length; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const e1 = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]], e2 = [X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2]], pv = cross(D, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
      const tv = [O[0] - X[a], O[1] - X[a + 1], O[2] - X[a + 2]], u = dot(tv, pv) / det; if (u < 0 || u > 1) continue; const qv = cross(tv, e1), v = dot(D, qv) / det; if (v < 0 || u + v > 1) continue; const d = dot(e2, qv) / det; if (d > 0 && d < best) best = d; }
    return best; };
  const out = [];
  for (let i = 0; i <= n; i++) { const ph = pf + (pb - pf) * i / n, k1 = sstep(pf, Math.PI / 2, ph), k2 = sstep(Math.PI / 2, pb, ph), x = ph < Math.PI / 2 ? front[0] + (xs - front[0]) * k1 : xs + (back[0] - xs) * k2;
    const D = [0, -Math.sin(ph), -Math.cos(ph)], O = [x, yc - D[1] * 0.5, zc - D[2] * 0.5], d = hit(O, D); if (isFinite(d)) out.push([O[0] + D[0] * d, O[1] + D[1] * d, O[2] + D[2] * d]); }
  // a strap is under tension: the path is pulled taut (umbrella steps) and only kept OUTSIDE the body, so it bridges the hollow above
  // the breast instead of dipping into it (the ray hits jumped from the breast's top to the chest wall: a 2-3 cm kink)
  B.surf ||= new SurfaceMesh(B.X, B.tris, { cell: 0.02, normals: B.N });
  for (let it = 0; it < 60; it++) { for (let i = 1; i + 1 < out.length; i++) out[i] = out[i].map((c, j) => 0.5 * c + 0.25 * (out[i - 1][j] + out[i + 1][j]));
    for (let i = 1; i + 1 < out.length; i++) { const q = B.surf.closestAny(out[i][0], out[i][1], out[i][2], 0.05); if (q && q.d < 0) out[i] = [q.px, q.py, q.pz]; } }
  return out;
}
// the inframammary fold under one apex: the first minimum of the front profile going down (as person/index.js bustBand)
function foldUnder(B, nip) {
  const z = new Map(), d = 0.005; for (let v = 0; v < B.nb; v++) { if (B.region[v] !== 2) continue; const x = Math.abs(B.X[v * 3]), y = B.X[v * 3 + 1]; if (Math.abs(x - Math.abs(nip[0])) > 0.03 || y > nip[1] || y < nip[1] - 0.2) continue;
    const k = Math.round((nip[1] - y) / d); z.set(k, Math.max(z.get(k) ?? -9, B.X[v * 3 + 2])); }
  let kmin = 8, zmin = Infinity; for (let k = 0; k <= 40; k++) { const zz = z.get(k); if (zz == null) continue; if (zz < zmin) { zmin = zz; kmin = k; } else if (zz > zmin + 0.006 && zmin < (z.get(0) ?? 0) - 0.01) break; }
  return nip[1] - Math.max(kmin, 6) * d;
}
// the measures each outline is drawn from (all bind, metres)
function frame(B) {
  const L = B.L, F = {}; const avg = (a, b) => a.map((c, i) => (c + b[i]) / 2);
  F.ss = L('suprasternale'); F.c7 = L('cervicale'); F.navel = L('omphalion'); F.pubis = L('pubis'); F.sacrum = L('sacrum');
  F.asis = avg(L('asisL'), L('asisR').map((c, i) => (i ? c : -c))); F.crest = avg(L('iliacCrestL'), L('iliacCrestR').map((c, i) => (i ? c : -c)));
  F.troch = avg(L('trochanterL'), L('trochanterR').map((c, i) => (i ? c : -c))); F.glute = avg(L('gluteFoldL'), L('gluteFoldR').map((c, i) => (i ? c : -c)));
  F.axF = avg(L('axillaFrontL'), L('axillaFrontR').map((c, i) => (i ? c : -c))); F.axB = avg(L('axillaBackL'), L('axillaBackR').map((c, i) => (i ? c : -c))); F.acr = avg(L('acromionL'), L('acromionR').map((c, i) => (i ? c : -c)));
  F.nip = avg(L('nippleL'), L('nippleR').map((c, i) => (i ? c : -c)));
  // the crotch: the lowest torso / pelvis vertex near the midline
  let yc = Infinity; for (let v = 0; v < B.nb; v++) { const r = B.region[v]; if ((r === 2 || r === 7) && Math.abs(B.X[v * 3]) < 0.03) yc = Math.min(yc, B.X[v * 3 + 1]); } F.yCrotch = yc;
  // the neck's half width at its base, and the top of the shoulder halfway to the acromion
  let xn = 0, k = 0; for (let v = 0; v < B.nb; v++) if (B.region[v] === 1 && Math.abs(B.X[v * 3 + 1] - (F.c7[1] + 0.035)) < 0.01) { xn = Math.max(xn, Math.abs(B.X[v * 3])); k++; } F.xNeck = k ? clamp(xn + 0.008, 0.05, 0.08) : 0.062;
  return F;
}
// garment -> { f(x, y, z, region): signed (m), holds(x, y, z, region): bool, label(x, y, z, region): panel id, meta }
function outline(B, kind, spec) {
  const F = frame(B), K = FOUNDATION_KINDS[kind], th = B.theta;
  const arm = r => r === 3 || r === 4 || r === 5 || r === 6, head = r => r === 0 || r === 11 || r === 1, leg = r => r === 8 || r === 9 || r === 10;
  if (K.part === 'bra') {
    const nipL = B.L('nippleL'), nipR = B.L('nippleR'), yAp = (nipL[1] + nipR[1]) / 2, xAp = (Math.abs(nipL[0]) + Math.abs(nipR[0])) / 2, ta = Math.abs(th(nipL[0], nipL[1], nipL[2]));
    const yFold = Math.min(foldUnder(B, nipL), foldUnder(B, nipR)), yAx = (F.axF[1] + F.axB[1]) / 2;
    // the top of the breast's footprint at the apex's x (lane A's breastFoot weights)
    let yFoot = yAp + 0.07; try { const w = B.S.dense('breastFoot'); let m = -Infinity; for (let v = 0; v < B.nb; v++) if (w[v] > 0.25 && Math.abs(Math.abs(B.X[v * 3]) - xAp) < 0.02) m = Math.max(m, B.X[v * 3 + 1]); if (isFinite(m)) yFoot = m; } catch (e) { /* no field */ }
    const sports = kind === 'bra.sports', soft = kind === 'bra.soft';
    const yBot = yFold - (sports ? 0.042 : soft ? 0.022 : 0.024), cov = soft ? 0.62 : 0.58, yCup = yAp + cov * Math.max(0.03, yFoot - yAp);
    const yGore = sports ? yAp + 0.42 * (F.ss[1] - yAp) : yFold + (soft ? 0.06 : 0.04), yBack = sports ? yAx - 0.07 : yBot + (soft ? 0.036 : 0.042), yWing = sports ? yAx - 0.035 : yAx - 0.05;
    const top = sports ? curve([[0, yGore], [ta, yGore + 0.012], [ta + 0.35, yGore + 0.02], [1.45, yWing], [2.15, yBack], [Math.PI, yBack]])
      : curve([[0, yGore], [ta * 0.92, yCup], [ta + 0.2, yCup - 0.004], [1.42, yWing], [2.05, yBack], [Math.PI, yBack]]);
    // straps: from the cup's top (a little outside the apex) over the shoulder (between the neck and the acromion) down to the back band
    const halfW = (sports ? 0.032 : soft ? 0.012 : 0.0115) / 2, straps = [];
    for (const s of [1, -1]) {
      const a0 = (ta + (sports ? 0.05 : 0.18)) * s, yA = top(a0) - 0.006; let best = null; for (let v = 0; v < B.nb; v++) { if (B.region[v] !== 2) continue; const x = B.X[v * 3], y = B.X[v * 3 + 1], z = B.X[v * 3 + 2]; if (Math.sign(x) !== s || z < B.zc(y)) continue; const d = Math.abs(th(x, y, z) - a0) * 0.1 + Math.abs(y - yA); if (!best || d < best[0]) best = [d, [x, y, z]]; }
      const xs = s * (F.xNeck + (sports ? 0.03 : 0.035)), sh = [xs, F.acr[1] + 0.04, (F.c7[2] + F.ss[2]) / 2 - 0.005];
      const xb = s * (sports ? F.xNeck + 0.045 : xAp * 0.98), yb = yBack - 0.012, a1 = best ? best[1] : [s * xAp, yA, 0.15];
      let bk = null; for (let v = 0; v < B.nb; v++) { if (B.region[v] !== 2) continue; const x = B.X[v * 3], y = B.X[v * 3 + 1], z = B.X[v * 3 + 2]; if (z > B.zc(y) || Math.abs(y - yb) > 0.02) continue; const d = Math.abs(x - xb) + Math.abs(y - yb); if (!bk || d < bk[0]) bk = [d, [xb, yb, z]]; }
      const back = bk ? bk[1] : [xb, yb, -0.1];
      straps.push(strapPath(B, [a1[0], spec.f8?.strapSew ? a1[1] + 0.0035 : a1[1] - 0.012, a1[2]], sh[0], back, F.acr[1] - 0.08)); }
    const gore = x => Math.abs(x) < 0.011;
    return { F, meta: { yAp, xAp, ta, yFold, yBot, yCup, yGore, yBack, yFoot, straps: straps.length },
      straps, strapW: 2 * halfW,
      f: (x, y, z, r) => { if (arm(r) || head(r) || leg(r)) return -1; return Math.min(y - yBot, top(th(x, y, z)) - y); },
      hold: (x, y, z, r) => (spec.holds.includes('gore') && gore(x) && z > B.zc(y) && y < yGore + 0.004) || (spec.holds.includes('wire') && Math.abs(y - (yFold - 0.003)) < 0.006 && Math.abs(Math.abs(th(x, y, z)) - ta) < 0.75 && z > B.zc(y)),
      label: (x, y, z) => { const a = Math.abs(th(x, y, z)); if (y > top(th(x, y, z)) + 0.004) return 4; if (y < (sports ? yBot + 0.03 : yFold) || a > 1.25) return 2; if (gore(x)) return 3; return x > 0 ? 0 : 1; },   // 0 cup L, 1 cup R, 2 band, 3 gore, 4 strap
      labels: ['cupL', 'cupR', 'band', 'gore', 'strap'], thickOf: lab => (lab <= 1 ? spec.cupThick : spec.thick) };
  }
  if (K.part === 'briefs' || K.part === 'boxers') {
    const men = K.sex === 'm', boxers = K.part === 'boxers';
    // the top: a mid rise, level with the iliac crest at the side, a little lower in front (under the navel), at the sacrum behind
    const yF = men ? Math.min(F.navel[1] - 0.075, F.asis[1] - 0.01) : Math.min(F.navel[1] - 0.06, F.asis[1] + 0.005), yS = (F.asis[1] + F.crest[1]) / 2 - 0.01, yB = Math.max(F.sacrum[1] + 0.02, yS - 0.01);
    const top = curve([[0, yF], [0.9, (yF + yS) / 2], [Math.PI / 2, yS], [2.4, yB], [Math.PI, yB]]);
    // the leg openings: a plane per leg through the side (deep enough for a full brief), the gusset's front and back corners
    const yCr = F.yCrotch, sideY = yS - (men ? 0.105 : 0.095), zcC = B.zc(yCr + 0.03);
    const planes = [1, -1].map(s => { const Ps = [s * Math.abs(F.troch[0]) * 1.05, sideY, B.zc(sideY)], Pf = [s * (men ? 0.05 : 0.038), yCr + 0.012, zcC + 0.05], Pb = [s * 0.065, F.glute[1] - 0.004, zcC - 0.06];
      let n = nrm(cross(sub(Pf, Ps), sub(Pb, Ps))); if (dot(n, sub([0, top(0), B.zc(top(0))], Ps)) < 0) n = n.map(c => -c); return { P: Ps, n, s }; });
    // boxer briefs: the leg cut square to the thigh 12 cm below the crotch
    const kj = B.kin?.joints || {}, legPl = [1, -1].map(s => { const hj = kj[s > 0 ? 'HJC_L' : 'HJC_R'] || [s * 0.09, yCr + 0.08, 0], kn = kj[s > 0 ? 'KJC_L' : 'KJC_R'] || [s * 0.1, yCr - 0.4, 0], d = nrm(sub(hj, kn)), t = (yCr - 0.12 - kn[1]) / (hj[1] - kn[1]); return { P: kn.map((c, i) => c + (hj[i] - c) * t), n: d, s }; });
    // (CLOTH8 c10 it1) THE FORK: a brief's leg opening runs in the crease where the trunk's underside meets the thigh (the genitocrural
    // fold), and no brief lies on a thigh's MEDIAL face below it. The planes above meet the midline 2-3 cm below the crotch, so where the
    // thighs are close (ANAT8-PELVIS's solved thighs: a gap 3-4 cm wide under the perineum, the thighs in contact below it) the cut took
    // both walls of the gap 2.5-4.5 cm down, and the stance's adduction pinched them into a flap. The underside's height along the
    // midline (the lowest trunk point per 5 mm of depth, |x| < 12 mm) is the crease's level: a medial-facing point (its normal towards
    // the other thigh) more than `forkDrop` below it is cut, faded in by how medially it faces (continuous: the cut is a level set).
    const fork = []; if (!boxers) { const zb = new Map(); for (let v = 0; v < B.nb; v++) { const r = B.region[v]; if (!(r === 2 || r === 7) || Math.abs(B.X[v * 3]) > 0.012) continue; const yv = B.X[v * 3 + 1]; if (yv > yCr + 0.06) continue; const k = Math.round(B.X[v * 3 + 2] / 0.005); if (!zb.has(k) || yv < zb.get(k)) zb.set(k, yv); }
      for (const [k, yv] of zb) fork.push([k * 0.005, yv]); fork.sort((a, b) => a[0] - b[0]); }
    const forkY = z => { if (fork.length < 3 || z < fork[0][0] || z > fork[fork.length - 1][0]) return null; let i = 0; while (i + 1 < fork.length && fork[i + 1][0] < z) i++; const a = fork[i], b = fork[Math.min(fork.length - 1, i + 1)], t = b[0] > a[0] ? (z - a[0]) / (b[0] - a[0]) : 0; return a[1] + (b[1] - a[1]) * t; };
    const forkDrop = spec.forkDrop ?? 0.006;
    return { F, meta: { yF, yS, yB, sideY, yCr, fork: fork.length },
      f: (x, y, z, r, nx = 0) => { if (arm(r) || head(r) || r === 9 || r === 10) return -1; let f = top(th(x, y, z)) - y; if (y < yCr - 0.2) return -1;
        if (boxers) { const L = legPl[x >= 0 ? 0 : 1]; if (r === 8 || y < yCr + 0.02) f = Math.min(f, dot(L.n, sub([x, y, z], L.P))); }
        else { for (const Pl of planes) f = Math.min(f, dot(Pl.n, sub([x, y, z], Pl.P)));
          const yU = Math.abs(x) < 0.07 ? forkY(z) : null; if (yU != null) { const m = sstep(0.4, 0.7, -nx * Math.sign(x || 1)); if (m > 0) f = Math.min(f, y - (yU - forkDrop) + (1 - m) * 0.2); } }
        return f; },
      hold: () => false,
      label: (x, y, z) => { const a = Math.abs(th(x, y, z)); if (y > top(th(x, y, z)) - (spec.waistBind || 0.01)) return 3; if (y < yCr + 0.03 && Math.abs(x) < 0.05) return 2; return a < Math.PI / 2 ? 0 : 1; },   // 0 front, 1 back, 2 gusset, 3 waistband
      labels: ['front', 'back', 'gusset', 'waistband'], thickOf: lab => (lab === 3 ? spec.thick * 2 : lab === 2 ? spec.thick * 2 : spec.thick) };
  }
  // undershirts
  const tee = K.part === 'tee', yAx = (F.axF[1] + F.axB[1]) / 2, yHem = (F.asis[1] + F.troch[1]) / 2 - 0.02, xN = F.xNeck;
  const yTopSh = F.acr[1] + 0.03, kj = B.kin?.joints || {};
  const neckF = tee ? F.ss[1] + 0.008 : F.ss[1] - 0.075, neckB = tee ? F.c7[1] - 0.015 : F.c7[1] - 0.05, xOut = xN + 0.055;
  const xEdge = xN + (tee ? 0.014 : 0.01), pw = tee ? 2.0 : 2.2;
  const necky = (x, y, z) => { const ax = Math.abs(x); if (ax >= xEdge) return Infinity; const y0 = z > B.zc(y) ? neckF : neckB; return y0 + (yTopSh + 0.05 - y0) * Math.pow(ax / xEdge, pw); };
  const armLim = y => xOut + 0.3 * sstep(yAx + 0.02, yAx - 0.075, y);
  const sleeve = (x, y, z) => { const s = x >= 0 ? 'L' : 'R', S0 = kj['SJC_' + s], E0 = kj['EJC_' + s]; if (!S0 || !E0) return -1; const u = sub(E0, S0), t = dot(sub([x, y, z], S0), u) / dot(u, u); return 0.4 - t; };
  return { F, meta: { yAx, yHem, xN, neckF, neckB },
    f: (x, y, z, r) => { if (r === 0 || r === 11 || leg(r) || r === 4 || r === 5 || r === 6) return -1; let f = Math.min(y - yHem, necky(x, y, z) - y);
      if (r === 3) { if (tee) return Math.min(f, sleeve(x, y, z) * 0.25); if (y < yAx + 0.01 || Math.abs(x) > xOut) return -1; }
      if (!tee) f = Math.min(f, armLim(y) - Math.abs(x)); return f; },
    hold: () => false, label: (x, y, z, r) => (r === 3 ? 2 : z > B.zc(y) ? 0 : 1), labels: ['front', 'back', 'sleeve'], thickOf: () => K.thick };
}

// ---------------------------------------------------------------- mesh operations
// one Phong-midpoint subdivision of the chosen body triangles: new points on the body's smooth surface; per vertex: position, normal,
// region, body source (two body vertices and a weight), so skin weights and the bind body can be read back
function subdivide(B, faces) {
  const X = [], N = [], R = [], SRC = [], map = new Map(), id = v => { if (map.has(v)) return map.get(v); const k = X.length / 3; X.push(B.X[v * 3], B.X[v * 3 + 1], B.X[v * 3 + 2]); N.push(B.N[v * 3], B.N[v * 3 + 1], B.N[v * 3 + 2]); R.push(B.region[v]); SRC.push(v, v, 0); map.set(v, k); return k; };
  const em = new Map(), mid = (a, b) => { const key = a < b ? a * 1e6 + b : b * 1e6 + a; if (em.has(key)) return em.get(key); const ia = id(a), ib = id(b), k = X.length / 3;
    const pa = [B.X[a * 3], B.X[a * 3 + 1], B.X[a * 3 + 2]], pb = [B.X[b * 3], B.X[b * 3 + 1], B.X[b * 3 + 2]], na = [B.N[a * 3], B.N[a * 3 + 1], B.N[a * 3 + 2]], nb = [B.N[b * 3], B.N[b * 3 + 1], B.N[b * 3 + 2]], m = pa.map((c, i) => (c + pb[i]) / 2);
    const prj = (pp, n) => { const d = dot(sub(m, pp), n); return m.map((c, i) => c - d * n[i]); }, qa = prj(pa, na), qb = prj(pb, nb), al = 0.75, q = m.map((c, i) => (1 - al) * c + al * (qa[i] + qb[i]) / 2), nn = nrm(na.map((c, i) => c + nb[i]));
    X.push(...q); N.push(...nn); R.push(B.region[a]); SRC.push(a, b, 0.5); em.set(key, k); void ia; void ib; return k; };
  const T = []; for (let t = 0; t < faces.length; t += 3) { const a = faces[t], b = faces[t + 1], c = faces[t + 2], A = id(a), Bb = id(b), C = id(c), ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); T.push(A, ab, ca, ab, Bb, bc, ca, bc, C, ab, bc, ca); }
  return { X: Float64Array.from(X), N: Float64Array.from(N), R: Uint8Array.from(R), SRC: Float64Array.from(SRC), T: Int32Array.from(T), bodyMap: map };
}
// the mesh cut along f = 0 (marching triangles), keeping f > 0. New vertices on cut edges interpolate everything
function cut(M, f) {
  const n = M.X.length / 3, keep = new Int32Array(n).fill(-1), X = [], N = [], R = [], SRC = [], onEdge = [];
  const addV = i => { if (keep[i] >= 0) return keep[i]; keep[i] = X.length / 3; X.push(M.X[i * 3], M.X[i * 3 + 1], M.X[i * 3 + 2]); N.push(M.N[i * 3], M.N[i * 3 + 1], M.N[i * 3 + 2]); R.push(M.R[i]); SRC.push(M.SRC[i * 3], M.SRC[i * 3 + 1], M.SRC[i * 3 + 2]); onEdge.push(0); return keep[i]; };
  const em = new Map(), cutV = (a, b) => { const key = a < b ? a * 1e7 + b : b * 1e7 + a; if (em.has(key)) return em.get(key); const t = f[a] / (f[a] - f[b]), k = X.length / 3;
    for (let c = 0; c < 3; c++) X.push(M.X[a * 3 + c] + (M.X[b * 3 + c] - M.X[a * 3 + c]) * t); const nn = nrm([0, 1, 2].map(c => M.N[a * 3 + c] + (M.N[b * 3 + c] - M.N[a * 3 + c]) * t)); N.push(...nn);
    const ins = f[a] > 0 ? a : b; R.push(M.R[ins]); SRC.push(M.SRC[ins * 3], M.SRC[ins * 3 + 1], M.SRC[ins * 3 + 2]); onEdge.push(1); em.set(key, k); return k; };
  const T = [];
  for (let t = 0; t < M.T.length; t += 3) { const v = [M.T[t], M.T[t + 1], M.T[t + 2]], s = v.map(i => f[i] > 0); const c = s.filter(Boolean).length; if (c === 0) continue;
    if (c === 3) { T.push(addV(v[0]), addV(v[1]), addV(v[2])); continue; }
    // rotate so that v[0] is the odd one out
    let r = 0; for (let k = 0; k < 3; k++) if ((c === 1 && s[k]) || (c === 2 && !s[k])) r = k; const a = v[r], b = v[(r + 1) % 3], d = v[(r + 2) % 3];
    if (c === 1) T.push(addV(a), cutV(a, b), cutV(a, d));
    else { const ab = cutV(b, a), ad = cutV(d, a); T.push(ab, addV(b), addV(d), ab, addV(d), ad); } }
  return { X: Float64Array.from(X), N: Float64Array.from(N), R: Uint8Array.from(R), SRC: Float64Array.from(SRC), T: Int32Array.from(T), keep, onEdge: Uint8Array.from(onEdge) };
}
// connected components by triangles; drop the small ones (a stray island of a cut)
function dropIslands(M, minTris = 40) {
  const n = M.X.length / 3, par = Int32Array.from({ length: n }, (_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let t = 0; t < M.T.length; t += 3) { const a = find(M.T[t]), b = find(M.T[t + 1]), c = find(M.T[t + 2]); par[b] = a; par[find(c)] = a; }
  const cnt = new Map(); for (let t = 0; t < M.T.length; t += 3) { const r = find(M.T[t]); cnt.set(r, (cnt.get(r) || 0) + 1); }
  const T = []; for (let t = 0; t < M.T.length; t += 3) if (cnt.get(find(M.T[t])) >= minTris) T.push(M.T[t], M.T[t + 1], M.T[t + 2]);
  return { ...M, T: Int32Array.from(T) };
}
export function neighbours(T, n) { const nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); } return nb.map(s => Int32Array.from(s)); }
// open boundary loops, each an ordered list of vertex ids (closed loops repeat nothing; open chains are kept as they are)
export function boundaryLoops(T, n) {
  const E = new Map(); for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = T[t + k], b = T[t + (k + 1) % 3], key = a < b ? a * n + b : b * n + a; const e = E.get(key); if (e) e.c++; else E.set(key, { a, b, c: 1 }); }
  const next = new Map(); for (const e of E.values()) if (e.c === 1) next.set(e.a, e.b);   // directed as in its triangle (the loop runs with the interior on its left)
  const seen = new Set(), loops = [];
  for (const s of next.keys()) { if (seen.has(s)) continue; const L = []; let v = s; while (v != null && !seen.has(v)) { seen.add(v); L.push(v); v = next.get(v); } if (L.length > 2) loops.push({ ids: L, closed: v === s }); }
  return loops;
}
// a boundary flag per vertex
function boundaryFlags(T, n) { const f = new Uint8Array(n); for (const L of boundaryLoops(T, n)) for (const v of L.ids) f[v] = 1; return f; }

// ---------------------------------------------------------------- the membrane: tension against the body
function relax(M, collider, { its, gapOf, holdOf, lambda = 0.5 }) {
  const n = M.X.length / 3, nb = neighbours(M.T, n), bnd = boundaryFlags(M.T, n), X = Float64Array.from(M.X), base = M.X, N = M.N, gap = new Float64Array(n), held = new Uint8Array(n);
  for (let v = 0; v < n; v++) { gap[v] = gapOf(v); held[v] = bnd[v] || holdOf(v) ? 1 : 0; for (let c = 0; c < 3; c++) X[v * 3 + c] = base[v * 3 + c] + N[v * 3 + c] * gap[v]; }
  const Y = new Float64Array(n * 3); let push = 0;
  for (let it = 0; it < its; it++) {
    for (let v = 0; v < n; v++) { if (held[v] || !nb[v].length) { for (let c = 0; c < 3; c++) Y[v * 3 + c] = X[v * 3 + c]; continue; } let sx = 0, sy = 0, sz = 0; for (const u of nb[v]) { sx += X[u * 3]; sy += X[u * 3 + 1]; sz += X[u * 3 + 2]; } const k = nb[v].length;
      Y[v * 3] = X[v * 3] + lambda * (sx / k - X[v * 3]); Y[v * 3 + 1] = X[v * 3 + 1] + lambda * (sy / k - X[v * 3 + 1]); Y[v * 3 + 2] = X[v * 3 + 2] + lambda * (sz / k - X[v * 3 + 2]); }
    push = 0; for (let v = 0; v < n; v++) { if (held[v]) continue; const q = collider.closest(Y[v * 3], Y[v * 3 + 1], Y[v * 3 + 2], 0.06); if (!q) continue; if (q.d < gap[v]) { const k = gap[v] - q.d; Y[v * 3] += q.nx * k; Y[v * 3 + 1] += q.ny * k; Y[v * 3 + 2] += q.nz * k; push = Math.max(push, k); } }
    X.set(Y); }
  // how far the membrane stands off the body (bridging), per vertex
  const lift = new Float64Array(n); for (let v = 0; v < n; v++) { const q = collider.closest(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.08); lift[v] = q ? q.d - gap[v] : 0; }
  return { X, held, bnd, lift, lastPush: push };
}
// the collider: the subdivided body region with the nipples relaxed into the breast (a cup or a tensioned knit presses them)
function colliderOf(Msub, B, relaxAt = []) {
  const X = Float64Array.from(Msub.X), n = X.length / 3;
  if (relaxAt.length) { const nb = neighbours(Msub.T, n), w = new Float64Array(n); for (let v = 0; v < n; v++) { let d = Infinity; for (const q of relaxAt) d = Math.min(d, Math.hypot(X[v * 3] - q[0], X[v * 3 + 1] - q[1], X[v * 3 + 2] - q[2])); if (d < 0.04) w[v] = 1 - (d / 0.04) ** 2; }
    for (let it = 0; it < 40; it++) { const Y = Float64Array.from(X); for (let v = 0; v < n; v++) { if (!w[v] || !nb[v].length) continue; let s = [0, 0, 0]; for (const u of nb[v]) for (let c = 0; c < 3; c++) s[c] += X[u * 3 + c]; for (let c = 0; c < 3; c++) Y[v * 3 + c] += 0.6 * w[v] * (s[c] / nb[v].length - X[v * 3 + c]); } X.set(Y); } }
  return new SurfaceMesh(X, Msub.T, { cell: 0.015, normals: relaxAt.length ? vertexNormals(X, Msub.T) : Msub.N });   // the relaxed surface's own normals (the nipple's fanned normals pushed its bump back into the cup)
}

// ---------------------------------------------------------------- one foundation garment, fitted (bind space, metres)
export function fitFoundation(B, kind, opts = {}) {
  const t0 = now(), spec = { ...FOUNDATION_KINDS[kind], ...opts }; if (!FOUNDATION_KINDS[kind]) throw new Error('foundations: unknown kind ' + kind);
  const f8 = { ...FOUND8, ...(opts.f8 || {}) }; if (f8.strapSew || f8.bridge > 0 || f8.edgeCover !== 2 || f8.cupLift > 0) spec.f8 = f8;
  const O = outline(B, kind, spec), X = B.X;
  // the body triangles near the garment (a 4 cm margin), subdivided once on the smooth surface
  const fb = new Float64Array(B.nb); for (let v = 0; v < B.nb; v++) fb[v] = O.f(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], B.region[v], B.N[v * 3], B.N[v * 3 + 1], B.N[v * 3 + 2]);
  const faces = []; for (let t = 0; t < B.tris.length; t += 3) { const a = B.tris[t], b = B.tris[t + 1], c = B.tris[t + 2]; if (Math.max(fb[a], fb[b], fb[c]) > -0.04) faces.push(a, b, c); }
  const Msub = subdivide(B, faces), ns = Msub.X.length / 3, f = new Float64Array(ns);
  for (let v = 0; v < ns; v++) f[v] = O.f(Msub.X[v * 3], Msub.X[v * 3 + 1], Msub.X[v * 3 + 2], Msub.R[v], Msub.N[v * 3], Msub.N[v * 3 + 1], Msub.N[v * 3 + 2]);
  // no vertex exactly on the level (a degenerate cut)
  for (let v = 0; v < ns; v++) if (Math.abs(f[v]) < 1e-5) f[v] = 1e-5;
  let M = dropIslands(cut(Msub, f), 30);
  // the collider: the subdivided region (its smooth surface), nipples relaxed for a bra or any top
  const relaxAt = (spec.part === 'bra' || spec.part === 'tank' || spec.part === 'tee') ? [B.L('nippleL'), B.L('nippleR')] : [];
  const coll = colliderOf(Msub, B, relaxAt);
  // (CLOTH8 c10 it1) THE ELASTIC EDGE: an edge cut by marching triangles on a 1-1.5 cm mesh zigzags (the leg openings 7-11 mm p95 off
  // their own chord, up to 2 cm where the outline's planes meet), and the membrane holds it as cut: the brief's ragged leg openings. A
  // binding under tension lies smooth: each open edge is smoothed along itself (Taubin lambda|mu: no shrinkage, so a leg opening does not
  // creep down the thigh) and put back on the body's surface, before the membrane relaxes against it. `edgeSmooth` rounds (0: as cut).
  const eS = spec.edgeSmooth ?? 12; if (eS > 0) { const nM = M.X.length / 3; for (const L of boundaryLoops(M.T, nM)) { const ids = L.ids, m = ids.length; if (m < 8) continue; const Y = new Float64Array(m * 3);
      for (let it = 0; it < eS * 2; it++) { const k = it % 2 ? -0.53 : 0.5; for (let i = 0; i < m; i++) { const a = ids[i], pv = ids[(i - 1 + m) % m], nx = ids[(i + 1) % m], ends = !L.closed && (i === 0 || i === m - 1);
          for (let c = 0; c < 3; c++) Y[i * 3 + c] = ends ? M.X[a * 3 + c] : M.X[a * 3 + c] + k * ((M.X[pv * 3 + c] + M.X[nx * 3 + c]) / 2 - M.X[a * 3 + c]); }
        for (let i = 0; i < m; i++) for (let c = 0; c < 3; c++) M.X[ids[i] * 3 + c] = Y[i * 3 + c]; }
      for (const a of ids) { const q = coll.closestAny ? coll.closestAny(M.X[a * 3], M.X[a * 3 + 1], M.X[a * 3 + 2], 0.03) : coll.closest(M.X[a * 3], M.X[a * 3 + 1], M.X[a * 3 + 2], 0.03); if (!q) continue; M.X[a * 3] = q.px; M.X[a * 3 + 1] = q.py; M.X[a * 3 + 2] = q.pz; M.N[a * 3] = q.nx; M.N[a * 3 + 1] = q.ny; M.N[a * 3 + 2] = q.nz; } } }
  // per vertex: its panel label (thickness), whether it is held
  const nv = M.X.length / 3, lab = new Uint8Array(nv); for (let v = 0; v < nv; v++) lab[v] = O.label(M.X[v * 3], M.X[v * 3 + 1], M.X[v * 3 + 2], M.R[v]);
  const allow = 0.0006;   // the skin allowance: over the smooth surface (the drawn body is flat between its 2 cm vertices: inside this)
  const R = relax(M, coll, { its: spec.its, gapOf: v => allow + O.thickOf(lab[v]) / 2, holdOf: v => O.hold(M.X[v * 3], M.X[v * 3 + 1], M.X[v * 3 + 2], M.R[v]) });
  if (spec.f8?.bridge > 0 && (spec.part === 'briefs' || spec.part === 'boxers')) R.bridge8 = bridgeFork(R.X, M, O.meta, spec.f8.bridge);
  if (spec.f8?.cupLift > 0 && spec.part === 'bra') { const ap = [B.L('nippleL'), B.L('nippleR')]; R.cup8 = membraneLift(R.X, M, (x, y, z) => Math.max(...ap.map(a => 1 - sstep(0.03, 0.045, Math.hypot(x - a[0], y - a[1], z - a[2])))), spec.f8.cupLift); }
  const Xf = R.X, tris = M.T, Nf = vertexNormals(Xf, tris);
  // orient outward (the body's winding): flip if the mean normal points into the body
  let sgn = 0; for (let v = 0; v < nv; v += 7) sgn += Nf[v * 3] * M.N[v * 3] + Nf[v * 3 + 1] * M.N[v * 3 + 1] + Nf[v * 3 + 2] * M.N[v * 3 + 2];
  if (sgn < 0) { for (let t = 0; t < tris.length; t += 3) { const b = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = b; } for (let i = 0; i < Nf.length; i++) Nf[i] = -Nf[i]; }
  // per triangle panel (majority of its corners), and a flat uv: arc length round the torso (theta x the local radius) and height
  const tlab = new Uint8Array(tris.length / 3); for (let t = 0; t < tlab.length; t++) { const a = lab[tris[t * 3]], b = lab[tris[t * 3 + 1]], c = lab[tris[t * 3 + 2]]; tlab[t] = a === b || a === c ? a : b === c ? b : a; }
  const uv = new Float64Array(nv * 2); for (let v = 0; v < nv; v++) { const x = Xf[v * 3], y = Xf[v * 3 + 1], z = Xf[v * 3 + 2], r = Math.hypot(x, z - B.zc(y)); uv[v * 2] = B.theta(x, y, z) * Math.max(0.06, r); uv[v * 2 + 1] = y; }
  // which body vertices it covers (an original body vertex kept in the cut, 2+ rings from the garment's edge)
  const ring = new Int32Array(nv).fill(99), nbM = neighbours(tris, nv); let fr = []; for (let v = 0; v < nv; v++) if (R.bnd[v]) { ring[v] = 0; fr.push(v); }
  for (let r = 0; r < 4 && fr.length; r++) { const nx = []; for (const v of fr) for (const u of nbM[v]) if (ring[u] > r + 1) { ring[u] = r + 1; nx.push(u); } fr = nx; }
  const loops0 = boundaryLoops(tris, nv), bw = spec.bind[0], wb = spec.waistBind || bw, extra = new Float64Array(nv);
  { const pts = []; for (const L of loops0) { let ymin = Infinity, ymax = -Infinity; for (const v of L.ids) { ymin = Math.min(ymin, Xf[v * 3 + 1]); ymax = Math.max(ymax, Xf[v * 3 + 1]); } const w = (spec.part === 'briefs' || spec.part === 'boxers') && ymax - ymin < 0.12 && ymin > (O.meta.sideY ?? -9) ? wb : bw; for (const v of L.ids) pts.push([Xf[v * 3], Xf[v * 3 + 1], Xf[v * 3 + 2], w]); }
    for (let v = 0; v < nv; v++) { let e = 0; for (const q of pts) { const d = Math.hypot(Xf[v * 3] - q[0], Xf[v * 3 + 1] - q[1], Xf[v * 3 + 2] - q[2]); if (d < q[3] + 0.002) { e = 2 * spec.bind[1] + 0.0008; break; } } extra[v] = e; } }
  const cover = new Uint8Array(B.nb), dressed = new Float64Array(B.nb * 3); dressed.set(B.X); const thickAt = new Float64Array(B.nb);
  const ec = spec.f8?.edgeCover ?? 2; for (const [bv, k] of Msub.bodyMap) { const j = M.keep[k]; if (j < 0) continue; if (ring[j] >= ec) cover[bv] = 1; const t = O.thickOf(lab[j]) + extra[j]; thickAt[bv] = t; for (let c = 0; c < 3; c++) dressed[bv * 3 + c] = Xf[j * 3 + c] + Nf[j * 3 + c] * (O.thickOf(lab[j]) / 2 + extra[j]); }
  // the elastic bindings: every open edge (loops ordered with the garment on their left)
  const loops = boundaryLoops(tris, nv).map(L => ({ ...L, kind: loopKind(L, Xf, O, spec) }));
  const st = { verts: nv, tris: tris.length / 3, loops: loops.length, liftMaxMm: +(Math.max(...R.lift) * 1000).toFixed(1), liftMeanMm: +(R.lift.reduce((a, b) => a + b, 0) / nv * 1000).toFixed(2), held: R.held.reduce((a, b) => a + b, 0), lastPushMm: +(R.lastPush * 1000).toFixed(2), ms: Math.round(now() - t0) };
    // straps (bras): ribbons laid along their path over the body, over the cup where they start on it
  const straps = (O.straps || []).map(Pl => { const pts = [], Nn = [], src = []; for (const q of Pl) { let bv = 0, bd = Infinity; for (let v = 0; v < B.nb; v++) { if (B.region[v] !== 2 && B.region[v] !== 1) continue; const d = (B.X[v * 3] - q[0]) ** 2 + (B.X[v * 3 + 1] - q[1]) ** 2 + (B.X[v * 3 + 2] - q[2]) ** 2; if (d < bd) { bd = d; bv = v; } }
      const n = [B.N[bv * 3], B.N[bv * 3 + 1], B.N[bv * 3 + 2]], qq = (B.surf || coll).closestAny(q[0], q[1], q[2], 0.03), base = qq && qq.d < 0 ? [qq.px, qq.py, qq.pz] : q, onCup = O.meta.yCup != null && q[2] > B.zc(q[1]) ? sstep(O.meta.yCup + 0.012, O.meta.yCup - 0.006, q[1]) : 0;
      const off = allow + spec.thick + (spec.cupThick - spec.thick) * onCup + 0.0006; pts.push(base.map((c, i) => c + (qq ? [qq.nx, qq.ny, qq.nz][i] : n[i]) * off)); Nn.push(qq ? [qq.nx, qq.ny, qq.nz] : n); src.push(bv); }
    return { pts, N: Nn, src, w: O.strapW }; });
  return { kind, spec, X: Xf, N: Nf, tris, uv, SRC: M.SRC, R: M.R, lab, tlab, labels: O.labels, loops, straps, ring, lift: R.lift, cover, dressed, thickAt, meta: O.meta, report: st };
}
// CLOTH8 (opt-in, FOUND8.bridge): the briefs' shell over the fork and the lower front lifted as a membrane over the hollows: per vertex a
// height h along the body's normal (0 = the fit), raised towards the mean of its neighbours' surface (never lowered), at most `maxLift`,
// in the region round the crotch (from the gusset to 10 cm over it, within 7 cm of the midline, faded at its rim)
function bridgeFork(X, M, meta, maxLift) { const yCr = meta.yCr; return membraneLift(X, M, (x, y) => (1 - sstep(0.05, 0.075, Math.abs(x))) * (1 - sstep(yCr + 0.08, yCr + 0.12, y)), maxLift); }
function membraneLift(X, M, wOf, maxLift) {
  const n = X.length / 3, N = M.N, nb = neighbours(M.T, n), w = new Float64Array(n); let k = 0;
  for (let v = 0; v < n; v++) { w[v] = wOf(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); if (w[v] > 0) k++; }
  const X0 = Float64Array.from(X), h = new Float64Array(n);
  for (let it = 0; it < 60; it++) { for (let v = 0; v < n; v++) { if (!w[v]) continue; let sx = 0, sy = 0, sz = 0, c = 0; for (const u of nb[v]) { sx += X[u * 3]; sy += X[u * 3 + 1]; sz += X[u * 3 + 2]; c++; } if (!c) continue;
      const t = ((sx / c - X0[v * 3]) * N[v * 3] + (sy / c - X0[v * 3 + 1]) * N[v * 3 + 1] + (sz / c - X0[v * 3 + 2]) * N[v * 3 + 2]); h[v] = Math.min(maxLift * w[v], Math.max(h[v], t)); }
    for (let v = 0; v < n; v++) if (w[v]) for (let c = 0; c < 3; c++) X[v * 3 + c] = X0[v * 3 + c] + N[v * 3 + c] * h[v]; }
  let mx = 0, mean = 0; for (let v = 0; v < n; v++) { mx = Math.max(mx, h[v]); mean += h[v]; } return { verts: k, maxMm: +(mx * 1000).toFixed(2), meanMm: +(mean / Math.max(1, k) * 1000).toFixed(2) };
}
// what an edge loop is: the waist or the band's lower edge (a wide elastic), else a narrow binding
function loopKind(L, X, O, spec) {
  let ymin = Infinity, ymax = -Infinity; for (const v of L.ids) { ymin = Math.min(ymin, X[v * 3 + 1]); ymax = Math.max(ymax, X[v * 3 + 1]); }
  if (spec.part === 'bra' && O.meta && Math.abs(ymax - O.meta.yBot) < 0.02 && ymax - ymin < 0.03) return 'band';
  if ((spec.part === 'briefs' || spec.part === 'boxers') && ymax - ymin < 0.12 && ymin > O.meta.sideY) return 'waist';
  return 'edge';
}

// ---------------------------------------------------------------- sweeps: a profile carried along a curve on a surface
// pts: [[x,y,z]], nrm: [[x,y,z]] (the surface normal), inward: [[x,y,z]] (in the surface, toward the cloth), prof: [[u, v]] (u along
// inward, v along the normal); closed: a loop. Returns { X: Float64Array, T: Int32Array, src: Int32Array (the curve point each vertex
// came from) }. Normals are left to the renderer.
export function sweep(pts, nrmA, inward, prof, closed = true) {
  const m = pts.length, k = prof.length, X = new Float64Array(m * k * 3), src = new Int32Array(m * k), T = [];
  for (let i = 0; i < m; i++) for (let j = 0; j < k; j++) { const [u, v] = prof[j]; for (let c = 0; c < 3; c++) X[(i * k + j) * 3 + c] = pts[i][c] + inward[i][c] * u + nrmA[i][c] * v; src[i * k + j] = i; }
  const seg = closed ? m : m - 1; for (let i = 0; i < seg; i++) { const i2 = (i + 1) % m; for (let j = 0; j + 1 < k; j++) { const a = i * k + j, b = i * k + j + 1, c = i2 * k + j, d = i2 * k + j + 1; T.push(a, c, b, b, c, d); } }
  // wound so every face looks away from the profile's centroid (outward round the edge): the renderer's normals are then right
  const u0 = prof.reduce((x, q) => x + q[0], 0) / k, v0 = prof.reduce((x, q) => x + q[1], 0) / k, ctr = pts.map((q, i) => [0, 1, 2].map(c => q[c] + inward[i][c] * u0 + nrmA[i][c] * v0));
  const Ti = Int32Array.from(T); orientFrom(X, Ti, t => ctr[src[Ti[t * 3]]]); return { X, T: Ti, src };
}
// flip a mesh's winding when its faces, summed by area, look toward the reference points (ref(t): a point inside, per triangle)
export function orientFrom(X, T, ref) { let s = 0; for (let t = 0; t < T.length / 3; t++) { const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3, e1 = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]], e2 = [X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2]], n = cross(e1, e2), r = ref(t);
    const cx = (X[a] + X[b] + X[c]) / 3 - r[0], cy = (X[a + 1] + X[b + 1] + X[c + 1]) / 3 - r[1], cz = (X[a + 2] + X[b + 2] + X[c + 2]) / 3 - r[2]; s += Math.sign(n[0] * cx + n[1] * cy + n[2] * cz) * len(n); }
  if (s < 0) for (let t = 0; t < T.length; t += 3) { const b = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = b; } return s < 0; }
// the frame along a boundary loop of a mesh (X, N): points smoothed along the loop, normals, inward = the side the cloth is on
export function loopFrame(ids, X, N, closed = true, smooth = 2) {
  const m = ids.length; let P = ids.map(v => [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]); const Nn = ids.map(v => [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]]);
  for (let it = 0; it < smooth; it++) P = P.map((q, i) => { if (!closed && (i === 0 || i === m - 1)) return q; const a = P[(i - 1 + m) % m], b = P[(i + 1) % m]; return q.map((c, j) => (a[j] + 2 * c + b[j]) / 4); });
  const inward = P.map((q, i) => { const a = P[closed ? (i - 1 + m) % m : Math.max(0, i - 1)], b = P[closed ? (i + 1) % m : Math.min(m - 1, i + 1)], t = nrm(sub(b, a)); return nrm(cross(Nn[i], t)); });   // interior on the loop's left
  return { P, N: Nn, I: inward };
}
// the binding's cross-section: a strip of width w folded over the edge, thickness tb over the cloth (t), its fold rounded
export function bindingProfile(w, t, tb, seg = 5) {
  const o = t / 2 + tb, r = o, pr = [[w, t / 2 + tb * 0.35], [w * 0.92, o], [w * 0.3, o]];
  for (let s = 0; s <= seg; s++) { const a = Math.PI / 2 + Math.PI * s / seg; pr.push([Math.cos(a) * r * 0.9, Math.sin(a) * r]); }
  pr.push([w * 0.3, -o], [w * 0.92, -o], [w, -(t / 2 + tb * 0.35)]); return pr;
}

// ---------------------------------------------------------------- on a hero: meshes (plain data first, then the SkinnedMesh)
// skin weights for a shell vertex: its body sources' weights, blended and renormalised to the top four
export function mixWeights(SI, SW, a, b, t) { const m = new Map(); for (const [v, w0] of [[a, 1 - t], [b, t]]) { if (w0 <= 0) continue; for (let k = 0; k < 4; k++) { const j = SI[v * 4 + k], w = SW[v * 4 + k] * w0; if (w > 0) m.set(j, (m.get(j) || 0) + w); } }
  const top = [...m].sort((p, q) => q[1] - p[1]).slice(0, 4), s = top.reduce((x, y) => x + y[1], 0) || 1; const I = [0, 0, 0, 0], W = [0, 0, 0, 0]; top.forEach(([j, w], k) => { I[k] = j; W[k] = w / s; }); return [I, W]; }
// plain data of one fitted foundation (bind, metres): the shell and its bindings, each { name, X, T, SI, SW, uv, fabric, color, part }
export function foundationData(h, Fd, { color = '#e8e4da', bindColor = null, scale = 1, strapBlend = false } = {}) {
  const g = h.body.geometry, BI = g.attributes.skinIndex.array, BW = g.attributes.skinWeight.array, n = Fd.X.length / 3;
  const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4); for (let v = 0; v < n; v++) { const [I, W] = mixWeights(BI, BW, Fd.SRC[v * 3], Fd.SRC[v * 3 + 1], Fd.SRC[v * 3 + 2]); SI.set(I, v * 4); SW.set(W, v * 4); }
  const parts = [{ name: 'shell', X: Fd.X, T: Fd.tris, SI, SW, uv: Fd.uv, fabric: Fd.spec.fabric, color, part: Fd.spec.part, construction: 'shell' }];
  const [bw, tb] = Fd.spec.bind;
  for (const L of Fd.loops) { const fr = loopFrame(L.ids, Fd.X, Fd.N, L.closed, 3), w = L.kind === 'waist' ? (Fd.spec.waistBind || bw) : L.kind === 'band' ? Math.max(bw, 0.012) : bw;
    const t0 = Fd.spec.part === 'bra' ? Fd.spec.thick : Fd.spec.thick, prof = bindingProfile(w, t0, L.kind === 'waist' ? tb * 1.4 : tb), S = sweep(fr.P, fr.N, fr.I, prof, L.closed);
    const m = S.X.length / 3, si = new Uint16Array(m * 4), sw = new Float32Array(m * 4), uvb = new Float64Array(m * 2); for (let v = 0; v < m; v++) { const s = L.ids[S.src[v]]; si.set(SI.subarray(s * 4, s * 4 + 4), v * 4); sw.set(SW.subarray(s * 4, s * 4 + 4), v * 4); uvb[v * 2] = Fd.uv[s * 2]; uvb[v * 2 + 1] = (v % prof.length) * 0.002; }
    parts.push({ name: 'binding.' + L.kind, X: S.X, T: S.T, SI: si, SW: sw, uv: uvb, fabric: L.kind === 'edge' ? Fd.spec.fabric : 'rib', color: bindColor || color, part: Fd.spec.part, construction: L.kind === 'edge' ? 'binding' : 'elastic' }); }
  for (const [k, St] of (Fd.straps || []).entries()) { const m0 = St.pts.length, I = St.pts.map((q, i) => { const a = St.pts[Math.max(0, i - 1)], b = St.pts[Math.min(m0 - 1, i + 1)]; return nrm(cross(St.N[i], nrm(sub(b, a)))); }), w = St.w, t = 0.0014;
    const prof = [[-w / 2, 0], [-w / 2, t * 0.7], [-w / 2 + 0.0012, t], [w / 2 - 0.0012, t], [w / 2, t * 0.7], [w / 2, 0]], S = sweep(St.pts, St.N, I, prof, false), m = S.X.length / 3;
    // strapBlend (CLOTH3, opt-in): the strap's ends blend into what they are sewn to (the cup's edge, the back band) over 3 cm: its thickness
    // goes to nothing and it widens a little, so no knot stands where strap meets cup (the c8 judge's crop, engine and Cycles)
    const sew8 = !!Fd.spec.f8?.strapSew;
    if (strapBlend || sew8) { const arc = [0]; for (let i = 1; i < m0; i++) arc.push(arc[i - 1] + Math.hypot(...sub(St.pts[i], St.pts[i - 1]))); const tot = arc[m0 - 1];
      for (let v = 0; v < m; v++) { const i = S.src[v], k = sew8 ? Math.min(sstep(0, 0.012, arc[i]), strapBlend ? sstep(0, 0.03, tot - arc[i]) : 1) : Math.min(sstep(0, 0.03, arc[i]), sstep(0, 0.03, tot - arc[i])), [u, h0] = prof[v % prof.length], du = u * 0.35 * (1 - k), dv = -h0 * (1 - k) * 0.85;
        for (let c = 0; c < 3; c++) S.X[v * 3 + c] += I[i][c] * du + St.N[i][c] * dv; } }
    // skin weights averaged along the strap (+-4 path points): neighbouring points took vertices led by different bones, and the posed
    // strap kinked where they changed (a 3 cm jog over the upper chest)
    const PW = St.src.map((_, i) => { const acc = new Map(); for (let j = Math.max(0, i - 4); j <= Math.min(m0 - 1, i + 4); j++) { const b = St.src[j]; for (let c = 0; c < 4; c++) { const w = BW[b * 4 + c]; if (w > 0) acc.set(BI[b * 4 + c], (acc.get(BI[b * 4 + c]) || 0) + w); } }
      const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4), sm = top.reduce((x, y) => x + y[1], 0) || 1; const I = [0, 0, 0, 0], Wt = [0, 0, 0, 0]; top.forEach(([j, w], c) => { I[c] = j; Wt[c] = w / sm; }); return [I, Wt]; });
    const si = new Uint16Array(m * 4), sw = new Float32Array(m * 4), uvs = new Float64Array(m * 2); for (let v = 0; v < m; v++) { const [I, Wt] = PW[S.src[v]]; si.set(I, v * 4); sw.set(Wt, v * 4); uvs[v * 2] = (v % prof.length) * 0.003; uvs[v * 2 + 1] = S.src[v] * 0.01; }
    parts.push({ name: 'strap.' + k, X: S.X, T: S.T, SI: si, SW: sw, uv: uvs, fabric: 'rib', color: bindColor || color, part: Fd.spec.part, construction: 'strap' }); }
  void scale; return parts;
}
// a part (plain data) as a SkinnedMesh on the hero: the hero's own cloth material (c1 fabric shader, part 7: no hero cuts)
export function partMesh(h, P, scale, key = 'found') {
  const BG = h.body.geometry, BA = BG.attributes.position.constructor, g = new BG.constructor(), n = P.X.length / 3, pos = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) pos[i] = P.X[i] / scale;
  const AH = new Float32Array(n * 4); for (let v = 0; v < n; v++) AH[v * 4] = 2;
  g.setAttribute('position', new BA(pos, 3)); g.setAttribute('skinIndex', new BG.attributes.skinIndex.constructor(P.SI, 4)); g.setAttribute('skinWeight', new BA(P.SW, 4)); g.setAttribute('aHero', new BA(AH, 4));
  g.setAttribute('uv', new BA(Float32Array.from(P.uv || new Float32Array(n * 2)), 2)); g.setIndex(Array.from(P.T)); g.computeVertexNormals();
  const m = h._addCloth(g, { kind: 5, a: P.color, b: P.color, dirt: 0, part: 7, key, fab: P.fabric });
  m.material.side = 2; m.userData.k3 = { name: P.name, construction: P.construction, part: P.part }; m.castShadow = true; m.receiveShadow = true;
  if (h._fabDepth) m.customDepthMaterial = h._fabDepth(m.material);
  return m;
}
// the base layer on a hero: fitted on the hero's own body (bind; build the hero from supportedData(p, bra) so the bust is supported)
// specs: [{ id, kind, color?, bindColor? }]. Returns { list, cover (Uint8Array body verts), dressed (body positions over the base
// layer, metres: for tailor / bodyFrame), report }. h._found: Map(id -> { L, fit, data, meshes }) for the stack (design 'found.<part>')
export function wearFoundations(h, p, specs, { meshes = true } = {}) {
  const t0 = now(), scale = heroScale(h), BP = h.body.geometry.attributes.position.array, P = new Float64Array(p._S.nb * 3); for (let i = 0; i < P.length; i++) P[i] = BP[i] * scale;
  const B = bodyOf(p, P, h), list = [], cover = new Uint8Array(B.nb), dressed = Float64Array.from(B.X); h._found ||= new Map();
  let Bfit = B;
  for (const s of specs) { const Fd = fitFoundation(Bfit, s.kind, s.opts || {}), data = foundationData(h, Fd, { color: s.color, bindColor: s.bindColor, ...(s.strapBlend ? { strapBlend: true } : {}) });
    for (let v = 0; v < B.nb; v++) { if (Fd.cover[v]) cover[v] = 1; if (Fd.thickAt[v]) for (let c = 0; c < 3; c++) dressed[v * 3 + c] = Fd.dressed[v * 3 + c]; }
    const ms = meshes ? data.map(d => partMesh(h, d, scale, 'found_' + s.id)) : [];
    // a strap stands on the body: its thickness into the dressed body too (what goes over it drapes on it)
    for (const St of Fd.straps || []) for (let v = 0; v < B.nb; v++) { let near = false; for (const q of St.pts) if (Math.abs(q[1] - B.X[v * 3 + 1]) < 0.03 && Math.hypot(B.X[v * 3] - q[0], B.X[v * 3 + 1] - q[1], B.X[v * 3 + 2] - q[2]) < St.w / 2 + 0.006) { near = true; break; }
      if (near && !Fd.thickAt[v]) for (let c = 0; c < 3; c++) dressed[v * 3 + c] = B.X[v * 3 + c] + B.N[v * 3 + c] * 0.0028; }
    const e = { id: s.id, kind: s.kind, fit: Fd, data, meshes: ms, report: { ...Fd.report, label: Fd.spec.label, meta: Fd.meta } }; h._found.set(s.id, e); list.push(e);
    Bfit = bodyOf(p, Float64Array.from(dressed, (x, i) => x + (Fd.thickAt[Math.floor(i / 3)] ? B.N[i] * 0.0004 : 0)), h); }   // the next one goes over this one
  // what a later foundation covers of an earlier one is not drawn (an undershirt over the briefs' waistband: its elastic stands 2 mm
  // proud and came through the knit in patches)
  const culled = [];
  for (let j = 1; j < list.length; j++) { const Fo = list[j].fit, so = new SurfaceMesh(Fo.X, Fo.tris, { cell: 0.02, normals: Fo.N });
    for (let i = 0; i < j; i++) for (const d of list[i].data) { const n = d.X.length / 3, cv = new Uint8Array(n); for (let v = 0; v < n; v++) { const q = so.closestAny(d.X[v * 3], d.X[v * 3 + 1], d.X[v * 3 + 2], 0.02); if (!q) continue; const t = q.tri * 3; if (Fo.ring[Fo.tris[t]] >= 1 && Fo.ring[Fo.tris[t + 1]] >= 1 && Fo.ring[Fo.tris[t + 2]] >= 1 && q.d < 0.004) cv[v] = 1; }
      const T = []; let k = 0; for (let t = 0; t < d.T.length; t += 3) { if (cv[d.T[t]] && cv[d.T[t + 1]] && cv[d.T[t + 2]]) { k++; continue; } T.push(d.T[t], d.T[t + 1], d.T[t + 2]); } if (k) { d.T = Int32Array.from(T); culled.push({ part: list[i].id + '.' + d.name, under: list[j].id, tris: k }); } } }
  if (meshes) for (const e of list) { for (const m of e.meshes) m.removeFromParent(); e.meshes = e.data.map(d => partMesh(h, d, scale, 'found_' + e.id)); }
  return { list, cover, dressed, B, scale, report: { ms: Math.round(now() - t0), garments: list.map(e => ({ id: e.id, kind: e.kind, ...e.report })), culled } };
}
