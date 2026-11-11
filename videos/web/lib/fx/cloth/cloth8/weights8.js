// CLOTH8 (second resume, 8 Oct): THE BLACK BANDS AT THE ELBOW ARE NORMALS. The page draws a bake part from its BIND positions
// (person/v2.js partMesh2: computeVertexNormals on the bind mesh, then the skinning turns each normal by its vertex's blended bone
// matrix). Round the elbow the solver left the sleeve's skin weights noisy (a vertex all upper arm beside one half forearm): the posed
// cloth is smooth, but the bind cloth (each vertex taken back through its OWN blend) is crumpled, its normals point anywhere, and turned
// back by the skinning they face into the arm: the fabric shader and GTAO draw those vertices black (front faces, gl_FrontFacing right:
// FAB_DEBUG 4 blue). That is the "dark shard" of JUDGE c11's gate at the elbows (L05 L03 L20 L12 L23), unchanged by any posed-space fix.
// Here a sleeved garment's cloth takes the weights of the body's skin it lies on, by region: a SLEEVE panel's (most of its cloth within
// `sleeveR` of an arm curve) from the nearest skin of ITS arm (weights > 0.5 on that arm's bones), faded over `fade` below `top` from
// the shoulder joint into the nearest skin of any kind; every other panel from the nearest skin that is NOT arm (the torso beside a
// hanging arm follows the torso); smoothed `iter` times over the welded cloth (the seams agree); quantised as the bake stores them. The
// bind is then solved again through the new weights, so the posed cloth is exactly where it was (0.08 mm) and its bind is as smooth as
// the posed: the skinned normals agree with the surface. What is sewn on the garment (collars, plackets, pockets, hems, the new bands)
// takes the weights of the garment's nearest cloth, so it moves with it. A part whose dark corners do not drop keeps its old weights.
//   weights8(ctx) after rebuild8's commit (stage 'weights'); flips (drawn corners whose skinned normal is > 90 deg off the posed face) before / after
import { adjacency } from './relax8.js';
import { armCurve } from './sleeve8.js';
import { vertexNormals } from '../collide.js';
import { weldGarment } from '../cloth7/fold7.js';
export const WEIGHTS8_VERSION = 1;
export const WEIGHTS8 = { owners: ['shirt', 'top', 'outer'], construction: true, sleeveFrac: 0.6, sleeveR: 0.11, top: 0.04, armR: 0.13, iter: 12, keepSelf: 0.0, flipDot: 0.0, fade: 0.04, onArm: 0.015, onArmS: 0.12, sleeveX: 0.6 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// drawn corners whose skinned bind normal disagrees with the posed face normal (dot < flipDot): what the page draws dark
export function normalFlips(q, M, Pp, { flipDot = 0, mask = null } = {}) {
  const n = q.X.length / 3, NB = vertexNormals(Float64Array.from(q.X), q.T, new Float64Array(n * 3)); let bad = 0, all = 0;
  const skinN = v => { let x = 0, y = 0, z = 0; const a = NB[v * 3], b = NB[v * 3 + 1], c = NB[v * 3 + 2]; for (let k = 0; k < 4; k++) { const w = q.SW[v * 4 + k]; if (!w) continue; const m = q.SI[v * 4 + k] * 16; x += w * (M[m] * a + M[m + 4] * b + M[m + 8] * c); y += w * (M[m + 1] * a + M[m + 5] * b + M[m + 9] * c); z += w * (M[m + 2] * a + M[m + 6] * b + M[m + 10] * c); } const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  for (let t = 0; t < q.T.length; t += 3) { const a = q.T[t], b = q.T[t + 1], c = q.T[t + 2]; if (mask && !mask[a] && !mask[b] && !mask[c]) continue;
    const e1 = [Pp[b * 3] - Pp[a * 3], Pp[b * 3 + 1] - Pp[a * 3 + 1], Pp[b * 3 + 2] - Pp[a * 3 + 2]], e2 = [Pp[c * 3] - Pp[a * 3], Pp[c * 3 + 1] - Pp[a * 3 + 1], Pp[c * 3 + 2] - Pp[a * 3 + 2]];
    const nf = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(nf[0], nf[1], nf[2]); if (l < 1e-12) continue;
    for (const v of [a, b, c]) { const s = skinN(v); all++; if ((s[0] * nf[0] + s[1] * nf[1] + s[2] * nf[2]) / l < flipDot) bad++; } }
  return { bad, all };
}

// (UNFOLD, the weights diffused where the bind folds over at the underarm: measured too weak (L23 coat inverted 231 -> 185), off, and
// deleted c3 it1; git history has it. The underarm's bind fold is for a bind built from the pattern: NOTES, For CLOTH9.)

export function weights8(ctx, toBind, poseOf) {
  const { gar, W, J, M, scale, P, posed, body } = ctx, O = { ...WEIGHTS8, ...(ctx.O.weights || {}) }, rep = {}; if (!J?.shoulderL || !body?.SI || !body.bones) return null;
  const curves = ['L', 'R'].map(sd => armCurve(J['shoulder' + sd], J['elbow' + sd], J['wrist' + sd]));
  // the body's skin hashed three ways: arm L, arm R (weights > 0.5 on that arm's bones), not arm; and all
  const nb = body.X.length / 3, cell = 0.03, key = (i, j, k) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024), H = [new Map(), new Map(), new Map(), new Map()];
  const isArm = ['L', 'R'].map(sd => body.bones.map(nm => new RegExp(`^(upperarm|lowerarm|wrist|hand|finger|thumb|index|middle|ring|pinky|metacarpal)[^.]*\\.${sd}$`).test(nm)));
  for (let v = 0; v < nb; v++) { const kk = key(Math.floor(body.X[v * 3] / cell), Math.floor(body.X[v * 3 + 1] / cell), Math.floor(body.X[v * 3 + 2] / cell)), put = h => (H[h].get(kk) || H[h].set(kk, []).get(kk)).push(v); let arm = -1;
    for (let si = 0; si < 2; si++) { let s = 0; for (let k = 0; k < 4; k++) if (isArm[si][body.SI[v * 4 + k]]) s += body.SW[v * 4 + k]; if (s > 0.5) arm = si; } if (arm >= 0) put(arm); else put(2); put(3); }
  const nearest = (x, y, z, h) => { let best = -1, bd = Infinity; const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell); for (let r = 1; r <= 6 && best < 0; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) { if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) < r - 1) continue; for (const v of H[h].get(key(ci + a, cj + b, ck + c)) || []) { const d = (body.X[v * 3] - x) ** 2 + (body.X[v * 3 + 1] - y) ** 2 + (body.X[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = v; } } } return best; };
  const bodyW = v => { const mp = new Map(); if (v < 0) return mp; for (let k = 0; k < 4; k++) { const s = body.SW[v * 4 + k]; if (s > 0) mp.set(body.SI[v * 4 + k], (mp.get(body.SI[v * 4 + k]) || 0) + s); } return mp; };
  const mixW = (a, fa, b, fb) => { const mp = new Map(); for (const [k, s] of a) mp.set(k, s * fa); for (const [k, s] of b) mp.set(k, (mp.get(k) || 0) + s * fb); return mp; };
  // weights back on a part: top 4, quantised to 1/255 (the bake's bytes), renormalised
  const quant = (mp, SI2, SW2, i) => { const top = [...mp].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, x) => a + x[1], 0) || 1; const q = top.map(([bn, s]) => [bn, Math.round(s / sum * 255)]); const qs = q.reduce((a, x) => a + x[1], 0); if (q.length) q[0][1] += 255 - qs;
    for (let k = 0; k < 4; k++) { SI2[i * 4 + k] = q[k] ? q[k][0] : 0; SW2[i * 4 + k] = q[k] ? q[k][1] / 255 : 0; } };
  // re-bind a part through new weights, keep it if its dark corners drop
  const apply = (q, SI2, SW2, label, extra = {}) => { const n = q.X.length / 3, Pp = Float64Array.from(P(q)), f0 = normalFlips(q, M, Pp), SI0 = q.SI, SW0 = q.SW, X0 = Float64Array.from(q.X); q.SI = SI2; q.SW = SW2;
    toBind(q, Pp, M, scale, null); posed.set(q, poseOf(q, M, scale)); const Pn = P(q); let dmax = 0; for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.hypot(Pn[i * 3] - Pp[i * 3], Pn[i * 3 + 1] - Pp[i * 3 + 1], Pn[i * 3 + 2] - Pp[i * 3 + 2]));
    const f1 = normalFlips(q, M, Pn); if (f1.bad > f0.bad && !O.force) { q.SI = SI0; q.SW = SW0; q.X = X0; posed.set(q, Pp); rep[label] = { kept: true, flips: [f0.bad, f1.bad] }; }
    else rep[label] = { ...extra, flips: [f0.bad, f1.bad], corners: f0.all, posedMaxMm: +(dmax * 1000).toFixed(2) }; ctx.log('weights8', label, JSON.stringify(rep[label])); return f1.bad <= f0.bad; };
  for (const g of gar.filter(x => O.owners.includes(x.owner))) { const Wg = W.get(g) || weldGarment(g), m = Wg.m, n = g.X.length / 3, Pp = P(g);
    // each welded vertex: its nearest arm curve (side, s, dist); the sleeve panels
    const side = new Int8Array(m), sArm = new Float64Array(m), dArm = new Float64Array(m);
    for (let w = 0; w < m; w++) { const i = Wg.rep[w], p = [Pp[i * 3], Pp[i * 3 + 1], Pp[i * 3 + 2]]; let best = null; for (let si = 0; si < 2; si++) { const q = curves[si].near(p); if (!best || q.dist < best.dist) { best = q; side[w] = si; } } sArm[w] = best.s; dArm[w] = best.dist; }
    const np = g.panel ? Math.max(...g.panel) + 1 : 1, cnt = new Float64Array(np), close = new Float64Array(np); for (let i = 0; i < n; i++) { const pn = g.panel ? g.panel[i] : 0; cnt[pn]++; if (dArm[Wg.wid[i]] < O.sleeveR) close[pn]++; }
    // the sleeve panels, told in the BIND (the hero's rest: the arms away from the torso), so a folded or crossed arm in a dressed pose
    // does not make the torso's panels "sleeves": a panel whose mean |x| is over `sleeveX` of the widest panel's (and some of it near an arm)
    const ax = new Float64Array(np); for (let i = 0; i < n; i++) ax[g.panel ? g.panel[i] : 0] += Math.abs(g.X[i * 3]); for (let k = 0; k < np; k++) ax[k] /= cnt[k] || 1; const axMax = Math.max(...ax);
    const isSl = k => cnt[k] > 20 && ax[k] > O.sleeveX * axMax && close[k] / cnt[k] >= 0.3;
    // a sleeve panel's side by the vote of its cloth near the shoulder (folded or crossed arms: its forearm cloth can lie by the OTHER arm)
    const vote = new Float64Array(np * 2); for (let i = 0; i < n; i++) if (sArm[Wg.wid[i]] < 0.12) vote[(g.panel ? g.panel[i] : 0) * 2 + side[Wg.wid[i]]]++;
    const panelSide = k => (vote[k * 2 + 1] > vote[k * 2] ? 1 : 0);
    let Wm = new Array(m), nSl = 0;
    for (let w = 0; w < m; w++) { const i = Wg.rep[w], x = Pp[i * 3], y = Pp[i * 3 + 1], z = Pp[i * 3 + 2], sl = Wg.dups[w].every(j => isSl(g.panel ? g.panel[j] : 0));
      if (sl) { nSl++; const sd = panelSide(g.panel ? g.panel[Wg.dups[w][0]] : 0), f = sstep(O.top, O.top + O.fade, sArm[w]), a = f > 0 ? bodyW(nearest(x, y, z, sd)) : new Map(), b = f < 1 ? bodyW(nearest(x, y, z, 3)) : new Map(); Wm[w] = mixW(a, f, b, 1 - f); }
      else { // the torso's cloth follows the torso, unless it lies on an arm (the arm's skin clearly nearer than any other: a dropped shoulder)
        const a = nearest(x, y, z, 2), b = nearest(x, y, z, 3), da = a < 0 ? Infinity : Math.hypot(body.X[a * 3] - x, body.X[a * 3 + 1] - y, body.X[a * 3 + 2] - z), db = b < 0 ? Infinity : Math.hypot(body.X[b * 3] - x, body.X[b * 3 + 1] - y, body.X[b * 3 + 2] - z);
        const f = b === a || sArm[w] > O.onArmS ? 0 : sstep(0, O.onArm, da - db);   /* (only near the shoulder: a folded forearm over the chest is not the shirt's) */ Wm[w] = mixW(bodyW(b), f, bodyW(a), 1 - f); } }
    const A = adjacency(Wg.T, m);
    for (let it = 0; it < O.iter; it++) Wm = Wm.map((mp, w) => { const acc = new Map(mp); let c = 1; for (const u of A.nb[w]) { c++; for (const [b, s] of Wm[u]) acc.set(b, (acc.get(b) || 0) + s); } for (const [b, s] of acc) acc.set(b, s / c); return acc; });
    const SI2 = new Uint8Array(g.SI.length), SW2 = new Float32Array(g.SW.length); for (let i = 0; i < n; i++) quant(Wm[Wg.wid[i]], SI2, SW2, i);
    if (!apply(g, SI2, SW2, g.name, { sleeve: nSl, verts: m, sleevePanels: [...Array(np).keys()].filter(isSl) })) continue;
    // what is sewn on it: the weights of the garment's nearest cloth (posed)
    if (!O.construction) continue; const Pg = P(g), cg = 0.02, Hg = new Map(); for (let i = 0; i < n; i++) { const kk = key(Math.floor(Pg[i * 3] / cg), Math.floor(Pg[i * 3 + 1] / cg), Math.floor(Pg[i * 3 + 2] / cg)); (Hg.get(kk) || Hg.set(kk, []).get(kk)).push(i); }
    for (const q of ctx.parts) { if (q.group !== 'construction' || q.owner !== g.owner || !q.T?.length) continue; const nq = q.X.length / 3, Pq = P(q), SIq = new Uint8Array(nq * 4), SWq = new Float32Array(nq * 4); let miss = 0;
      for (let v = 0; v < nq; v++) { const x = Pq[v * 3], y = Pq[v * 3 + 1], z = Pq[v * 3 + 2], ci = Math.floor(x / cg), cj = Math.floor(y / cg), ck = Math.floor(z / cg); let best = -1, bd = Infinity;
        for (let r = 1; r <= 3 && best < 0; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) for (const i of Hg.get(key(ci + a, cj + b, ck + c)) || []) { const d = (Pg[i * 3] - x) ** 2 + (Pg[i * 3 + 1] - y) ** 2 + (Pg[i * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = i; } }
        if (best < 0) { miss++; for (let k = 0; k < 4; k++) { SIq[v * 4 + k] = q.SI[v * 4 + k]; SWq[v * 4 + k] = q.SW[v * 4 + k]; } continue; } for (let k = 0; k < 4; k++) { SIq[v * 4 + k] = g.SI[best * 4 + k]; SWq[v * 4 + k] = g.SW[best * 4 + k]; } }
      apply(q, SIq, SWq, q.name + (q.owner ? '@' + q.owner : ''), { miss }); } }
  return rep;
}
