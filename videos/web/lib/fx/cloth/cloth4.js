// CLOTH4 (CLOTHING round 4, 3 Oct; judge c9 step 2, "cloth edges"): the construction edges that read CG at 1:1 on the carried garments.
// Called by person/v3.js bakePersonV3 (its dressed default, carry 'carry3'); every piece is opt-in through the spec (c4Spec) and nothing
// existing imports this file, so every older bake, figure and scene is unchanged.
//   - CLOSED COLLAR (keepOpen): the body is not cut under the open collar (the neck, and the skin within `keep` of the neck opening):
//     the cull there opened holes in the neck that showed the shirt's unlit inside as black shards (L21, L20, L03)
//   - STIFF EDGES: the collar stand, the cuffs and the trousers' top band interfaced (sew.js interfacing: K1's solver, stiffer bending and
//     a stiffer band), and the WAISTBAND rebuilt as a stiff ring (waistRing): a smooth closed band (low-pass in angle round the waist:
//     its top edge reads straight at 1:1) outside the cloth it covers, the trousers' and the tucked shirt's cloth under it held inside
//     it, belt loops and the button on the ring
//   - TROUSERS (trouserEase, the bake's draft): a slimmer leg (less seat ease, the leg opening only a little over the boot shaft) and
//     the hem 2.5 cm shorter (hemUp 0.135 m at the outseam): one soft break over the boot
//   - THE WORK BOOT (wearBoots, boot4.js): a last-shaped 6-inch lace-up built outside hero.js, in the collider in place of the c7 boot
//     and drawn as the bake's parts (group 'boot'); the page hides the c7 boots when a bake carries a boot (the integrator's line)
// Neutral demo people (CAST's lineup); nothing here is a video's.
import { boneMats, skinPose, blendInverse } from './collide.js';
import { boundaryLoops, heroScale, orientFrom, sweep } from './foundations.js';
import * as FIN from './finish.js';
export const CLOTH4_VERSION = 1;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), now = () => (globalThis.performance ? performance.now() : Date.now());
const RG_NECK = 1, RG_TORSO = 2;

export const C4_DEFAULT = {
  collar: { keep: 0.035 },                                       // m round the neck opening where the skin is never cut (and the whole neck)
  stiff: { shirt: { panels: ['stand'], bendX: 12, stretchX: 2, shearX: 3 },   // (cuffs interfaced could not curl round the wrist when sewn: they stood out as funnels)
    trousers: { band: 0.045, bendX: 14, stretchX: 2.5, shearX: 4 } },
  ring: { height: 0.038, thick: 0.0028, harmR: 6, harmY: 3, sectors: 96, loops: 7, slack: 0.003, take: 0.040, blend: 0.030 },
  trousers: { hemUp: 0.135, seatEase: 0.04, kneeEase: 0.1, overBoot: 0.035, legsOut: 0.02 },
  boot: { height: 0.165, color: null },
  cuffJoin: { free: 0.018, up: 0.016, down: 0.006, lift: 0.0012 },   // the cuff's top 1.8 cm not held while sewn (stack.js cuffJoinFree); the seam band over the join
};
export function c4Spec(over = {}) {
  const o = {}; for (const [k, v] of Object.entries(C4_DEFAULT)) o[k] = over[k] === false ? null : (v && typeof v === 'object' ? { ...v, ...(over[k] && typeof over[k] === 'object' ? over[k] : {}) } : over[k] ?? v);
  return o;
}
// Titan's ease, slimmer (seat and knee ease; the leg opening is set by the bake from the boot: knee x (1 + kneeEase) >= shaft + overBoot)
export function trouserEase(ease0, T4) { return { ...ease0, ...(T4?.seatEase != null ? { seatEase: Math.min(ease0.seatEase ?? 0.06, T4.seatEase) } : {}), ...(T4?.kneeEase != null ? { kneeEase: Math.min(ease0.kneeEase ?? 0.15, T4.kneeEase) } : {}) }; }
// extra dressPerson options (none needed today: the interfacing rides on the outfit layers)
export function stackOpts(K4) { return K4.cuffJoin ? { cuffJoinFree: K4.cuffJoin.free } : {}; }

// ---------------------------------------------------------------- the boot (boot4.js), worn in the collider
let _boot = null; export async function loadCloth4() { _boot ||= await import('./boot4.js'); return true; }
export function wearBoots(h, p, spec, o) { if (!_boot) throw new Error('cloth4: await loadCloth4() first (boot4.js)'); return _boot.wearBoots(h, p, spec, o); }

// ---------------------------------------------------------------- finish4: the waistband ring, the boots' parts
// parts: the bake's part list (plain data, bind metres); edited in place (K3's waistband, belt loops and waist button replaced by the ring's)
export function finish4(h, Sx, parts, K4, { scale = heroScale(h), boot = null, sex = 'm', log = () => {} } = {}) {
  const t0 = now(), rep = {}; h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld);
  if (K4.ring) { const r = waistRing(h, Sx, parts, K4.ring, { scale, M, sex }); rep.ring = r; log('ring', JSON.stringify(r)); }
  if (K4.cuffJoin) { const r = cuffJoin(h, Sx, parts, K4.cuffJoin, { scale, M }); rep.cuffJoin = r; log('cuffJoin', JSON.stringify(r)); }
  if (boot) { for (const q of boot.parts) parts.push(q); rep.boot = boot.report; }
  if (K4.stiff) rep.fused = Object.fromEntries(['shirt', 'trousers'].map(id => [id, Sx.recs.get(id)?.c4fabs?.fused || null]));
  rep.ms = Math.round(now() - t0); return rep;
}

// the waistband as a stiff ring round the posed waist: the trousers' waist loop (the hold's run) as r(theta), y(theta) about its centre,
// low-passed (harmR / harmY harmonics), pushed out to clear the cloth in its height, then the band (a closed rolled section, 3.8 cm), 7 belt
// loops and the button on it; the trousers' cloth (and the tucked shirt's) under the band held inside it (posed, then back to bind)
function waistRing(h, Sx, parts, R4, { scale, M, sex }) {
  const tr = Sx.recs.get('trousers'); if (!tr) return { skipped: 'no trousers' }; const G = FIN.solved(h, tr), pat = tr.L.pattern, X = G.X;
  const holdIds = new Set(); for (const hd of pat.holds || []) for (const v of hd.verts) holdIds.add(G.gid(hd.panel, v));
  const loops = boundaryLoops(G.W.tris, G.n), wl = loops.map(L => ({ L, k: L.ids.filter(v => holdIds.has(v)).length })).sort((a, b) => b.k - a.k)[0]; if (!wl || wl.k < 10) return { skipped: 'no waist loop' };
  const ids = wl.L.ids; let cx = 0, cz = 0; for (const v of ids) { cx += X[v * 3]; cz += X[v * 3 + 2]; } cx /= ids.length; cz /= ids.length;
  const K = R4.sectors, TAU = Math.PI * 2, ang = (x, z) => ((Math.atan2(z - cz, x - cx) % TAU) + TAU) % TAU, sec = a => Math.floor(a / TAU * K) % K;
  // r(theta), y(theta) of the loop on K sectors (mean per sector, gaps filled round the circle)
  const rs = new Float64Array(K), ys = new Float64Array(K), cn = new Float64Array(K), src = new Int32Array(K).fill(-1), sd = new Float64Array(K).fill(Infinity);
  for (const v of ids) { const a = ang(X[v * 3], X[v * 3 + 2]), j = sec(a), r = Math.hypot(X[v * 3] - cx, X[v * 3 + 2] - cz); rs[j] += r; ys[j] += X[v * 3 + 1]; cn[j]++; const dc = Math.abs(a - (j + 0.5) / K * TAU); if (dc < sd[j]) { sd[j] = dc; src[j] = v; } }
  for (let j = 0; j < K; j++) if (cn[j] > 0) { rs[j] /= cn[j]; ys[j] /= cn[j]; }
  fillRound(rs, cn); fillRound(ys, cn); fillSrc(src);
  const yT = lowpass(ys, R4.harmY), r0 = lowpass(rs, R4.harmR), wb = R4.height, t = R4.thick;
  // the cloth the band covers: the trousers' particles in its height (and 1 cm over), per sector: the band clears the highest radius
  const rmax = Float64Array.from(r0); for (let p = 0; p < G.n; p++) { const x = X[p * 3], y = X[p * 3 + 1], z = X[p * 3 + 2], j = sec(ang(x, z)); if (y < yT[j] - wb - 0.004 || y > yT[j] + 0.01) continue; const r = Math.hypot(x - cx, z - cz); if (r > rmax[j]) rmax[j] = r; }
  // the band's inner face: the envelope, smoothed, not more than `slack` inside any covered cloth (the rest of the cloth is pulled in)
  const env = lowpass(Float64Array.from(rmax, (r, j) => Math.min(r, r0[j] + 0.012)), R4.harmR); let deficit = 0; for (let j = 0; j < K; j++) deficit = Math.max(deficit, rmax[j] - env[j]);
  const Ri = Float64Array.from(env, e => e + Math.min(deficit, R4.slack) * 0.5);
  const at = (arr, a) => { const f = a / TAU * K - 0.5, j0 = ((Math.floor(f) % K) + K) % K, j1 = (j0 + 1) % K, u = f - Math.floor(f); return arr[j0] * (1 - u) + arr[j1] * u; };
  // the trousers' and the shirt's cloth under the band held inside it (posed); garment parts edited in bind through their own weights
  const held = { trousers: 0, shirt: 0 };
  for (const q of parts) { if (q.group !== 'garment' || (q.owner !== 'trousers' && q.owner !== 'shirt')) continue; const n = q.X.length / 3, Xh = new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) Xh[i] = q.X[i] / scale;
    const P = skinPose(Xh, q.SI, q.SW, M, new Float64Array(n * 3), scale), tmp = [0, 0, 0], shirt = q.owner === 'shirt';
    // only the body of the garment round the waist: not a sleeve or a cuff (a forearm hanging or clasped at the band's height), nothing
    // more than 5 cm outside the band (a hand, a pocket bag)
    const names = q.panels || [], limbP = new Uint8Array(names.length); names.forEach((nm, k) => { limbP[k] = /^(sleeve|cuff)/.test(nm) ? 1 : 0; });
    const near = new Uint8Array(n); for (let v = 0; v < n; v++) { if (q.panel && limbP[q.panel[v]]) continue; const a = ang(P[v * 3], P[v * 3 + 2]); near[v] = Math.hypot(P[v * 3] - cx, P[v * 3 + 2] - cz) < at(Ri, a) + 0.05 ? 1 : 0; }
    // the TROUSERS' top band of cloth goes into the band: by distance from the waist edge in the flat pattern (dE: the interfaced band),
    // the top D0 of cloth is laid into the band's height and radius in order (its sagging flaps came out under the band's edge and showed
    // the shirt), the next D1 - D0 blended back to where it lies. The shirt is not moved (held in, its blousing stretched into spikes):
    // only its cloth wholly under the band is hidden.
    const D0 = R4.take, D1 = R4.take + R4.blend, dE = shirt ? null : edgeDist(q, tr.L.pattern, D1 + 0.01);
    if (!shirt) for (let v = 0; v < n; v++) { if (!near[v] || !(dE[v] <= D1)) continue; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], a = ang(x, z), top = at(yT, a), ri = at(Ri, a), r = Math.hypot(x - cx, z - cz);
      let ny, r2 = r;
      if (dE[v] <= D0) { ny = top - 0.0015 - dE[v] / D0 * (wb - 0.0055); r2 = Math.min(r, ri - 0.0008); }
      else { const s2 = sstep(D0, D1, dE[v]), yb = top - wb + 0.004 - (dE[v] - D0); ny = yb + (y - yb) * s2; }
      const k = r > 1e-4 ? r2 / r : 1, nx = cx + (x - cx) * k, nz = cz + (z - cz) * k; if (Math.abs(ny - y) < 1e-5 && k === 1) continue;
      blendInverse(q.SI, q.SW, v, M, nx / scale, ny / scale, nz / scale, tmp, 0); q.X[v * 3] = tmp[0] * scale; q.X[v * 3 + 1] = tmp[1] * scale; q.X[v * 3 + 2] = tmp[2] * scale; P[v * 3] = nx; P[v * 3 + 1] = ny; P[v * 3 + 2] = nz; held[q.owner]++; }
    // the cloth wholly under the band is not drawn (the band covers it; held in, a crumpled bit could still turn its inside out at 1:1)
    const inB = new Uint8Array(n); for (let v = 0; v < n; v++) { if (!near[v]) continue; const y = P[v * 3 + 1], a = ang(P[v * 3], P[v * 3 + 2]), top = at(yT, a);
      // the shirt: its cloth under the band and its tucked tail below it, near the waist (inside the trousers: where the trousers' top
      // band was laid into the band, the tail no longer had cloth over it and showed in patches under the band's edge)
      inB[v] = shirt ? (y < top - 0.003 && y > top - 0.16 && Math.hypot(P[v * 3] - cx, P[v * 3 + 2] - cz) < at(Ri, a) + 0.02 ? 1 : 0) : (dE[v] < D0 - 0.008 ? 1 : 0); }
    const keepT = []; let drop = 0; for (let k = 0; k < q.T.length; k += 3) { if (inB[q.T[k]] && inB[q.T[k + 1]] && inB[q.T[k + 2]]) { drop++; continue; } keepT.push(q.T[k], q.T[k + 1], q.T[k + 2]); }
    q.T = Int32Array.from(keepT); held[q.owner + 'TrisHidden'] = drop; if (q.Tfull) { const kf = []; for (let k = 0; k < q.Tfull.length; k += 3) if (!(inB[q.Tfull[k]] && inB[q.Tfull[k + 1]] && inB[q.Tfull[k + 2]])) kf.push(q.Tfull[k], q.Tfull[k + 1], q.Tfull[k + 2]); q.Tfull = Int32Array.from(kf); } }
  // the band: a closed rolled section swept round the ring (dr out from the inner face, dy down from the top)
  const prof = [[-0.0006, -wb], [-0.0006, -0.006], [0.0002, -0.0012], [t * 0.35, 0.0003], [t * 0.8, -0.0004], [t, -0.0028], [t, -wb + 0.0015], [t * 0.7, -wb - 0.0002], [0.0008, -wb - 0.0004]];
  const NP = prof.length, Xb = [], Tb = [], srcB = [], uvU = [], uvV = []; let arc = 0;
  for (let j = 0; j <= K; j++) { const a = (j % K + 0.5) / K * TAU, c = Math.cos(a), s = Math.sin(a), ri = Ri[j % K], top = yT[j % K];
    if (j > 0) { const ap = (j - 1 + 0.5) / K * TAU; arc += Math.hypot(cx + Math.cos(a) * ri - (cx + Math.cos(ap) * Ri[(j - 1) % K]), cz + s * ri - (cz + Math.sin(ap) * Ri[(j - 1) % K])); }
    prof.forEach(([dr, dy], k) => { Xb.push(cx + c * (ri + dr), top + dy, cz + s * (ri + dr)); srcB.push(j % K); uvU.push(arc); uvV.push(k < 2 ? -dy : k > NP - 3 ? wb + 0.002 - (dy + wb) : -dy); }); }
  for (let j = 0; j < K; j++) for (let k = 0; k < NP; k++) { const k2 = (k + 1) % NP, a = j * NP + k, b = j * NP + k2, c2 = (j + 1) * NP + k, d = (j + 1) * NP + k2; Tb.push(a, b, c2, b, d, c2); }
  orientFrom(Xb, Tb, tt => { const j = Math.min(K - 1, Math.floor(Tb[tt * 3] / NP)), a = (j + 0.5) / K * TAU; return [cx + Math.cos(a) * (Ri[j] + t / 2), yT[j] - wb / 2, cz + Math.sin(a) * (Ri[j] + t / 2)]; });
  const srcIds = Array.from(src), col = tr.L.color, fab = tr.fabric;
  for (let k = parts.length - 1; k >= 0; k--) if (['waistband', 'beltloops', 'button.waist'].includes(parts[k].name) && parts[k].part === 'trousers') parts.splice(k, 1);
  const band = FIN.partFrom(h, tr, { X: Float64Array.from(Xb), T: Int32Array.from(Tb), src: Int32Array.from(srcB), uvU: Float64Array.from(uvU), uvV: Float64Array.from(uvV) }, srcIds, 'waistband', 'waistband', col, fab, scale, M);
  parts.push({ ...band, group: 'construction', sewn: 1, c4: 'ring' });
  // belt loops: from the band's top (folded 3 mm over it) to 6 mm under its bottom, 2 mm proud of its face, 1.1 cm wide
  let cfJ = 0, best = -Infinity; for (let j = 0; j < K; j++) { const a = (j + 0.5) / K * TAU, x = Math.cos(a) * Ri[j], z = Math.sin(a) * Ri[j], sc = z - Math.abs(x) * 3; if (sc > best) { best = sc; cfJ = j; } }
  const bl = [], blSrc = [], blT = []; const arcAt = [0]; for (let j = 1; j <= K; j++) { const a0 = (j - 0.5) / K * TAU, a1 = (j + 0.5) / K * TAU; arcAt.push(arcAt[j - 1] + Math.hypot(Math.cos(a1) * Ri[j % K] - Math.cos(a0) * Ri[j - 1], Math.sin(a1) * Ri[j % K] - Math.sin(a0) * Ri[j - 1])); }
  const tot = arcAt[K], fr = [0.11, 0.24, 0.37, 0.5, 0.63, 0.76, 0.89].slice(0, R4.loops);
  for (const f of fr) { const s0 = (arcAt[cfJ] + f * tot) % tot; let j = arcAt.findIndex(a2 => a2 >= s0); if (j < 0 || j >= K) j = K - 1; const a = (j + 0.5) / K * TAU, c = Math.cos(a), s = Math.sin(a), tg = [-s, 0, c], ri = Ri[j] + t, top = yT[j];
    const w = 0.0055, pr = [[0.0004, top + 0.0024], [0.0024, top + 0.0016], [0.0028, top - 0.004], [0.0026, top - wb], [0.0016, top - wb - 0.006], [0.0002, top - wb - 0.0065]];
    const base = bl.length / 3; for (const [dr, y] of pr) for (const sw of [-w, -w * 0.7, w * 0.7, w]) { const rr = ri + dr - (Math.abs(sw) > w * 0.9 ? 0.0008 : 0); bl.push(cx + c * rr + tg[0] * sw, y, cz + s * rr + tg[2] * sw); blSrc.push(j); }
    for (let a2 = 0; a2 + 1 < pr.length; a2++) for (let k = 0; k < 3; k++) { const p0 = base + a2 * 4 + k; blT.push(p0, p0 + 4, p0 + 1, p0 + 1, p0 + 4, p0 + 5); } }
  orientOut(bl, blT, cx, cz);
  parts.push({ ...FIN.partFrom(h, tr, { X: Float64Array.from(bl), T: Int32Array.from(blT), src: Int32Array.from(blSrc) }, srcIds, 'beltloops', 'beltloop', col, fab, scale, M), group: 'construction', sewn: 1, c4: 'ring' });
  // the button: men at the centre front, women on the left side (the slacks' side placket), on the band's face
  const men = sex !== 'f';
  let bj = cfJ; if (!men) { let bx = -Infinity; for (let j = 0; j < K; j++) { const a = (j + 0.5) / K * TAU, x = cx + Math.cos(a) * Ri[j], z = Math.sin(a) * Ri[j]; if (x > bx && z > Math.sin((cfJ + 0.5) / K * TAU) * Ri[cfJ] - 0.12) { bx = x; bj = j; } } }
  { const a = (bj + 0.5) / K * TAU, c = Math.cos(a), s = Math.sin(a), ri = Ri[bj] + t, p = [cx + c * (ri + 0.0004), yT[bj] - wb * 0.5, cz + s * (ri + 0.0004)], bt = FIN.buttonGeom(p, [c, 0, s], 0.0075, 0.0026);
    parts.push({ ...FIN.partFrom(h, tr, { X: bt.X, T: bt.T, src: new Int32Array(bt.X.length / 3) }, [srcIds[bj]], 'button.waist', 'button', '#3a3430', 'leather', scale, M, { solid: true }), group: 'construction', sewn: 1, c4: 'ring' }); }
  let wav = 0; for (let j = 0; j < K; j++) wav = Math.max(wav, Math.abs(ys[j] - yT[j])); let rw = 0; for (let j = 0; j < K; j++) rw = Math.max(rw, Math.abs(rs[j] - r0[j]));
  return { sectors: K, girthCm: +(tot * 100).toFixed(1), loopWaveMm: +(wav * 1000).toFixed(1), loopRadialMm: +(rw * 1000).toFixed(1), deficitMm: +(deficit * 1000).toFixed(1), held, loops: fr.length };
}
// the CUFF WINDOW (CARRY's open defect): an opening 1-1.5 cm long where the sleeve's gathered wrist edge meets the cuff, on the outside of
// most cuffs at 1:1. Traced (labs/clothing2/cloth4/orphans.mjs, the body hidden): no sleeve or cuff triangle is culled (0 unused vertices
// in either panel), it is not skin coming through (it stays with the body hidden: the sleeve's inside shows), the sleeve run and the cuff
// are welded (sew.js weldSewn merges every pair); the gathered sleeve edge (25.7 cm into a 23.9 cm cuff on L21, Simon's pleats as a gather)
// folds in under the cuff's top and the fold opens. Closed in construction: the join seam as a raised band (the gathered seam a real
// cuff shows), from `down` under the join to `up` over it, `lift` proud, in the shirt's fabric, round the join's particles in order.
function cuffJoin(h, Sx, parts, J4, { scale, M }) {
  const sh = Sx.recs.get('shirt'); if (!sh) return { skipped: 'no shirt' }; const G = FIN.solved(h, sh), out = {}, col = sh.L.color, fab = sh.fabric;
  for (const sd of ['L', 'R']) { const cp = 'cuff' + sd, sp = 'sleeve' + sd; const ids = []; for (let v = 0; v < G.n; v++) if (G.panels[v].has(cp) && G.panels[v].has(sp)) ids.push(v); if (ids.length < 6) { out[sd] = { skipped: ids.length }; continue; }
    // the forearm's axis (the wrist and elbow joints, posed) orders the join round it and gives "up the sleeve"
    const w = h.joint('wrist.' + sd), e = h.joint('lowerarm01.' + sd), sc = scale, W = [w.x * sc, w.y * sc, w.z * sc]; void W; let cx = 0, cy = 0, cz = 0; for (const v of ids) { cx += G.X[v * 3]; cy += G.X[v * 3 + 1]; cz += G.X[v * 3 + 2]; } cx /= ids.length; cy /= ids.length; cz /= ids.length;
    let ax = [e.x - w.x, e.y - w.y, e.z - w.z]; const al = Math.hypot(...ax) || 1; ax = ax.map(x => x / al);
    const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], b1 = norm3(cross3(ax, ref)), b2 = cross3(ax, b1);
    const ord = ids.map(v => { const d = [G.X[v * 3] - cx, G.X[v * 3 + 1] - cy, G.X[v * 3 + 2] - cz]; return [Math.atan2(dot3(d, b2), dot3(d, b1)), v]; }).sort((a, b) => a[0] - b[0]).map(q => q[1]);
    // the band goes OUTSIDE the opening (seen at 1:1 with the body hidden: the join ring sits ~1.5 cm deep in a fold, the cuff's top
    // turned in, its inside showing round it): per sector round the forearm the largest radius of the sleeve and cuff cloth within
    // `down` .. `up` of the join (along the forearm), low-passed, + `lift`; a short tube from `down` under the join to `up` over it
    const NS = 36, TAU = Math.PI * 2, ax0 = [cx, cy, cz], Rm = new Float64Array(NS), srcS = new Int32Array(NS).fill(-1), sdS = new Float64Array(NS).fill(Infinity);
    const angOf = d => { const a = Math.atan2(dot3(d, b2), dot3(d, b1)); return ((a % TAU) + TAU) % TAU; };
    for (let v = 0; v < G.n; v++) { if (!(G.panels[v].has(cp) || G.panels[v].has(sp))) continue; const d = sub3([G.X[v * 3], G.X[v * 3 + 1], G.X[v * 3 + 2]], ax0), t = dot3(d, ax); if (t < -J4.down || t > J4.up) continue;
      const rv = sub3(d, ax.map(x => x * t)), r = Math.hypot(...rv), j = Math.floor(angOf(rv) / TAU * NS) % NS; if (r > Rm[j]) Rm[j] = r; }
    for (const v of ord) { const d = sub3([G.X[v * 3], G.X[v * 3 + 1], G.X[v * 3 + 2]], ax0), rv = sub3(d, ax.map(x => x * dot3(d, ax))), a = angOf(rv), j = Math.floor(a / TAU * NS) % NS, dc = Math.abs(a - (j + 0.5) / NS * TAU); if (dc < sdS[j]) { sdS[j] = dc; srcS[j] = v; } }
    { const cn = Float64Array.from(Rm, r => (r > 0 ? 1 : 0)); fillRound(Rm, cn); } fillSrc(srcS);
    const Rb = lowpass(Rm, 4).map((r, j) => Math.max(r, Rm[j] - 0.002) + J4.lift), rows = [[-J4.down, -0.0012], [-J4.down + 0.002, 0], [J4.up - 0.003, 0], [J4.up, -0.0015]], Xb = [], Tb = [], srcB = [], uvU = [], uvV = [];
    for (let j = 0; j <= NS; j++) { const a = (j % NS + 0.5) / NS * TAU, dir = [b1[0] * Math.cos(a) + b2[0] * Math.sin(a), b1[1] * Math.cos(a) + b2[1] * Math.sin(a), b1[2] * Math.cos(a) + b2[2] * Math.sin(a)];
      for (const [t, dr] of rows) { const r = Rb[j % NS] + dr; for (let c = 0; c < 3; c++) Xb.push(ax0[c] + ax[c] * t + dir[c] * r); srcB.push(j % NS); uvU.push(a * Rb[j % NS]); uvV.push(t); } }
    const K = rows.length; for (let j = 0; j < NS; j++) for (let k = 0; k + 1 < K; k++) { const a = j * K + k, b = a + 1, c2 = a + K, d = c2 + 1; Tb.push(a, c2, b, b, c2, d); }
    orientFrom(Xb, Tb, tt => { const j = Math.min(NS - 1, Math.floor(Tb[tt * 3] / K)); return [ax0[0] + ax[0] * (J4.up - J4.down) / 2, ax0[1] + ax[1] * (J4.up - J4.down) / 2, ax0[2] + ax[2] * (J4.up - J4.down) / 2].map((c, i) => c + 0 * j * i); });
    const srcIds = Array.from(srcS), S = { X: Float64Array.from(Xb), T: Int32Array.from(Tb), src: Int32Array.from(srcB), uvU: Float64Array.from(uvU), uvV: Float64Array.from(uvV) };
    parts.push({ ...FIN.partFrom(h, sh, S, srcIds, 'cuff.join.' + sd, 'cuff', col, fab, scale, M), group: 'construction', sewn: 1, c4: 'cuffJoin' }); out[sd] = { join: ids.length, bandRadiusMm: +(Rb.reduce((x, y) => x + y, 0) / NS * 1000).toFixed(1), joinDepthMm: +((Rb.reduce((x, y) => x + y, 0) / NS - ord.reduce((x, v) => { const d = sub3([G.X[v * 3], G.X[v * 3 + 1], G.X[v * 3 + 2]], ax0); return x + Math.hypot(...sub3(d, ax.map(q => q * dot3(d, ax)))); }, 0) / ord.length) * 1000).toFixed(1) }; }
  return out;
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function keepOutTo(X, surf, gap) { for (let v = 0; v < X.length / 3; v++) { const q = surf.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.03); if (!q || q.edge) continue; if (q.d < gap) { const k = gap - q.d; X[v * 3] += q.nx * k; X[v * 3 + 1] += q.ny * k; X[v * 3 + 2] += q.nz * k; } } }
// per vertex of a garment part (pre-weld panels in the pattern's order), the flat-pattern distance to the nearest HOLD vertex of its own
// panel (the trousers' waist edge); Infinity past `cap`
function edgeDist(q, pat, cap) { const n = q.X.length / 3, out = new Float64Array(n).fill(Infinity), off = []; let o = 0; for (const pn of pat.panels) { off.push(o); o += pn.uv.length / 2; }
  const names = pat.panels.map(p => p.name);
  for (const hd of pat.holds || []) { const k = names.indexOf(hd.panel); if (k < 0) continue; const pn = pat.panels[k], o0 = off[k], m = pn.uv.length / 2, hv = Array.from(hd.verts);
    for (let i = 0; i < m; i++) { let b = Infinity; for (const v of hv) { const d = (pn.uv[i * 2] - pn.uv[v * 2]) ** 2 + (pn.uv[i * 2 + 1] - pn.uv[v * 2 + 1]) ** 2; if (d < b) b = d; } b = Math.sqrt(b); if (b <= cap && b < out[o0 + i]) out[o0 + i] = b; } }
  return out; }
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
// sector means with empty sectors filled by interpolation round the circle (cn: counts, 0 = empty)
function fillRound(a, cn) { const K = a.length, has = j => cn[j] > 0; if (![...cn].some(c => c > 0)) return; const b = Float64Array.from(a);
  for (let j = 0; j < K; j++) if (!has(j)) { let l = j, r = j, dl = 0, dr = 0; do { l = (l - 1 + K) % K; dl++; } while (!has(l)); do { r = (r + 1) % K; dr++; } while (!has(r)); b[j] = (a[l] * dr + a[r] * dl) / (dl + dr); }
  a.set(b); }
function fillSrc(s) { const K = s.length; for (let j = 0; j < K; j++) if (s[j] < 0) { let k = 1; while (k < K && s[(j + k) % K] < 0 && s[(j - k + K) % K] < 0) k++; s[j] = s[(j + k) % K] >= 0 ? s[(j + k) % K] : s[(j - k + K) % K]; } }
function lowpass(a, H) { const K = a.length, out = new Float64Array(K); for (let k = 0; k <= H; k++) { let c = 0, s = 0; for (let j = 0; j < K; j++) { const th = TAU0 * k * j / K; c += a[j] * Math.cos(th); s += a[j] * Math.sin(th); }
    c *= (k === 0 ? 1 : 2) / K; s *= 2 / K; for (let j = 0; j < K; j++) { const th = TAU0 * k * j / K; out[j] += c * Math.cos(th) + (k === 0 ? 0 : s * Math.sin(th)); } } return out; }
const TAU0 = Math.PI * 2;
// wind every triangle so its normal points away from the vertical axis through (cx, cz) (a band, a loop: closed thin solids)
function orientOut(X, T, cx, cz) { for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2], ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
  const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx, mx = (X[a * 3] + X[b * 3] + X[c * 3]) / 3 - cx, mz = (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3 - cz; void vy; if (nx * mx + nz * mz < 0) { T[t + 1] = c; T[t + 2] = b; } } }

// ---------------------------------------------------------------- keepOpen: no skin cut under the open collar
// cov: coverSkin's result (cov.full: the 13k body's culled triangles, dressed). A triangle stays drawn when any corner is on the neck, or on
// the torso within `keep` (posed) of the shirt's neck opening (the stand's free edge and the open fronts above the top button)
export function keepOpen(h, Sx, cov, K4) {
  if (!K4.collar) return null; const sh = Sx.recs.get('shirt'); if (!sh) return { skipped: 'no shirt' };
  const g = h.body.geometry, idx = g.index.array, P = g.attributes.position.array, AH = g.attributes.aHero?.array, n = P.length / 3, scale = heroScale(h); h.group.updateMatrixWorld(true);
  const M = boneMats(h.skeleton, h.body.matrixWorld), X = skinPose(Float64Array.from(P), g.attributes.skinIndex.array, g.attributes.skinWeight.array, M, new Float64Array(n * 3), scale);
  const G = FIN.solved(h, sh), neck = G.loops.map(L => ({ L, k: L.ids.filter(v => G.panels[v].has('stand')).length })).sort((a, b) => b.k - a.k)[0]?.L; if (!neck) return { skipped: 'no neck loop' };
  const pts = neck.ids.map(v => [G.X[v * 3], G.X[v * 3 + 1], G.X[v * 3 + 2]]), k2 = K4.collar.keep ** 2, keep = new Uint8Array(n); let yMin = Infinity; for (const q of pts) yMin = Math.min(yMin, q[1]);
  for (let v = 0; v < n; v++) { const r = AH ? Math.round(AH[v * 4]) : -1; if (r === RG_NECK) { keep[v] = 1; continue; } if (r !== RG_TORSO || X[v * 3 + 1] < yMin - K4.collar.keep) continue;
    for (const q of pts) { const d = (X[v * 3] - q[0]) ** 2 + (X[v * 3 + 1] - q[1]) ** 2 + (X[v * 3 + 2] - q[2]) ** 2; if (d < k2) { keep[v] = 1; break; } } }
  const before = cov.full.length, out = []; for (const t of cov.full) { const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2]; if (keep[a] || keep[b] || keep[c]) continue; out.push(t); }
  // the shin under the trouser leg near the hem (coverSkin leaves 4 rings by every cloth edge: with the slimmer leg the bent free knee's
  // shin came through the leg's front over the boot): culled where it is within 4 mm of the leg's cloth, the edge rings too
  const tr = Sx.recs.get('trousers'); let hemCut = 0;
  if (tr?.surf) { const cut = new Uint8Array(n), has = new Uint8Array(idx.length / 3); for (const t of out) has[t] = 1;
    for (let v = 0; v < n; v++) { const r = AH ? Math.round(AH[v * 4]) : -1; if (r !== 9 && r !== 8) continue; const q = tr.surf.closest(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.03); if (q && q.d < 0.004) cut[v] = 1; }
    for (let t = 0; t < idx.length / 3; t++) if (!has[t] && cut[idx[t * 3]] && cut[idx[t * 3 + 1]] && cut[idx[t * 3 + 2]]) { out.push(t); hemCut++; } }
  cov.full = Uint32Array.from(out.sort((a, b) => a - b)); return { trisFullBefore: before, trisFull: cov.full.length, kept: before - (cov.full.length - hemCut), hemCut, neckLoop: neck.ids.length };
}
export { clamp as _clamp };
