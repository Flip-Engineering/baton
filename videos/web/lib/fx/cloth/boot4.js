// BOOT4 (CLOTH4, round 4): a 6-inch lace-up work boot built outside hero.js, from the person's own foot (judge c9: the c7 boot's flared
// plate sole read as a game prop at 1:1). Per side: an UPPER lofted on a last (heel counter, waist, a ball wider on the inside, the toe line
// turned in toward the big toe, a rounded toe box with toe spring) united with a SHAFT round the ankle and lower shin (an oval tube from
// inside the upper to `height` over the ground, a padded collar rolled in at the top); a SOLE that follows the upper's outline 3 mm proud
// (a stitched welt edge, no flare: heel block 2.6 cm, forefoot 1.3 cm, the arch and the toe spring); a THROAT of 7 eyelet pairs from the
// vamp up the shaft front, the LACES crossing between them over a tongue line, a knot and two short ends at the top; a toe-cap seam.
// Skinned to foot / toe / lower leg as the c7 boot. wearBoots(h, p, spec) puts the uppers and soles in h.cloth.boots (the stack's
// collider, bootShell, the bake's boot girth) in place of the c7 meshes (hidden), and returns the parts (plain data, bind metres, group
// 'boot') for the bake. Units: hero bind units (metres at the nominal hero), as hero.js builds its boots.
import * as THREE from 'three';
import { lastUV7 } from './fabric7/last7.js';
export const BOOT4_VERSION = 1;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const lerpK = (K, t) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const u = (t - K[i - 1][0]) / (K[i][0] - K[i - 1][0]); return K[i - 1][1] + (K[i][1] - K[i - 1][1]) * u; } return K[K.length - 1][1]; };
const RG_SHIN = 9, RG_FOOT = 10;
// the last in plan and elevation (t: 0 heel .. 1 toe): half width (x the foot's half width), the upper's height over the sole's top
const WF = [[0, 0.6], [0.05, 0.8], [0.16, 0.86], [0.32, 0.84], [0.5, 0.93], [0.66, 1.0], [0.78, 0.98], [0.88, 0.86], [0.95, 0.66], [0.985, 0.42], [1, 0.12]];
const HF = [[0, 0.07], [0.06, 0.085], [0.16, 0.095], [0.3, 0.096], [0.42, 0.09], [0.55, 0.074], [0.68, 0.058], [0.8, 0.05], [0.9, 0.045], [0.96, 0.038], [0.99, 0.028], [1, 0.016]];

export function wearBoots(h, p, spec = {}, { scale = 1 } = {}) {
  const { height = 0.165, color = null, sole = '#211d19', lace = '#3b2a1c', eyelet = '#6f6a60' } = spec, I = h.idx, g = h.body.geometry, pos = g.attributes.position.array, AH = g.attributes.aHero.array, n = pos.length / 3;
  const col = color || h.o?.boots || '#4a3527', meshes = [], parts = [], rep = {};
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let v = 0; v < n; v++) if (Math.round(AH[v * 4]) === RG_FOOT && Math.sign(pos[v * 3]) === sg) { x0 = Math.min(x0, pos[v * 3]); x1 = Math.max(x1, pos[v * 3]); z0 = Math.min(z0, pos[v * 3 + 2]); z1 = Math.max(z1, pos[v * 3 + 2]); }
    const ank = h.head0[I['foot.' + side]], toeJ = h.head0[I['toe1-1.' + side]], bF = I['foot.' + side], bT = I['toe1-1.' + side], bS = I['lowerleg02.' + side];
    const W = (x1 - x0) / 2 + 0.0075, L = z1 - z0 + 0.027, zh = z0 - 0.009, cx = (x0 + x1) / 2, toeZ = toeJ.z;
    const cxT = t => cx - sg * W * 0.11 * sstep(0.45, 1, t);   // the toe line turned in toward the big toe
    const soleTop = t => (t < 0.25 ? 0.026 : t < 0.31 ? 0.026 - (t - 0.25) / 0.06 * 0.013 : 0.013) + spring(t), spring = t => 0.013 * sstep(0.78, 1, t) ** 1.4;
    const soleBot = t => (t > 0.3 && t < 0.56 ? 0.003 * Math.sin(Math.PI * (t - 0.3) / 0.26) : 0) + spring(t);
    const wgt = (z, y) => { const wt = sstep(toeZ - 0.015, toeZ + 0.02, z), ws = sstep(0.11, 0.19, y); return [[bF, (1 - wt) * (1 - ws)], [bT, wt * (1 - ws)], [bS, ws]].filter(q => q[1] > 1e-4).sort((a, b) => b[1] - a[1]); };
    const mk = () => ({ P: [], S: [], W: [], T: [], U: [] }), push = (A, x, y, z, u = 0, w = 0) => { A.P.push(x, y, z); const q = wgt(z, y); for (let k = 0; k < 4; k++) { A.S.push(q[k] ? q[k][0] : 0); A.W.push(q[k] ? q[k][1] : 0); } A.U.push(u, w); return A.P.length / 3 - 1; };
    const grid = (A, ra, rb, closed = true) => { const m = ra.length - (closed ? 0 : 1); for (let i = 0; i < m; i++) { const i2 = (i + 1) % ra.length; A.T.push(ra[i], rb[i], ra[i2], ra[i2], rb[i], rb[i2]); } };
    // ---- the upper on the last: sections across the foot, a superellipse (flat under, round over the toes)
    const U = mk(), NT = 26, seg = 36, rows = [];
    for (let k = 0; k <= NT; k++) { const t = k / NT, tt = t < 0.5 ? t : t, wf = lerpK(WF, tt), hh = lerpK(HF, tt), base = soleTop(tt), z = zh + tt * L, r = [];
      for (let i = 0; i < seg; i++) { const th = i / seg * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), e = 2 / 2.5;
        const x = cxT(tt) + W * wf * Math.sign(c) * Math.abs(c) ** e, y = base - 0.0015 + (sn > 0 ? hh * Math.abs(sn) ** (tt > 0.6 ? 0.7 : 0.85) : 0.0015 * sn);
        r.push(push(U, x, y, z, th * W, z)); } rows.push(r); }
    for (let k = 0; k < NT; k++) grid(U, rows[k + 1], rows[k]);   // (wound outward: the section turns counter-clockwise seen from the toe)
    const capA = (r, fw) => { let sx = 0, sy = 0, sz = 0; for (const v of r) { sx += U.P[v * 3]; sy += U.P[v * 3 + 1]; sz += U.P[v * 3 + 2]; } const c0 = push(U, sx / r.length, sy / r.length + (fw ? -0.004 : 0), sz / r.length + (fw ? 0.003 : -0.003));
      for (let i = 0; i < r.length; i++) { const i2 = (i + 1) % r.length; fw ? U.T.push(c0, r[i], r[i2]) : U.T.push(c0, r[i2], r[i]); } };   // wound outward (heel cap faces -z, toe cap +z) (CLOTH5: the two orders swapped; they faced in: K4's fixBootCaps, which is geometric, now finds nothing to turn)
    capA(rows[0], false); capA(rows[NT], true);
    lastUV7(U.P, U.U, U.T, null, { boot: true });   // FABRIC7: the toe's radial fan at its source (uv = theta W compressed up to 6x at the tip, the cap apex uv (0, 0)); the boot's nose keeps its built position
    // ---- the shaft: oval rings round the leg from inside the upper to `height`, sized from the person's own shin (+ 9 mm), the collar rolled in
    // the leg's section at height y: shin vertices within 9 cm of the ankle's vertical (the region labels stray), 5-95 % extents
    // CLOTH5 (opt-in spec.ownShin): only this side's shin (feet close together, the other shin within 9 cm widened the shaft to 41 cm on L14)
    const ownShin = !!spec.ownShin, sideOK = x => !ownShin || Math.sign(x) === sg;
    const ring = y => { const xs = [], zs = []; for (let v = 0; v < n; v++) { const r = Math.round(AH[v * 4]); if (r !== RG_SHIN || Math.abs(pos[v * 3 + 1] - y) > 0.012) continue; const x = pos[v * 3], z = pos[v * 3 + 2]; if (Math.hypot(x - ank.x, z - ank.z) > 0.09 || !sideOK(x)) continue; xs.push(x); zs.push(z); }
      if (xs.length < 8) return null; xs.sort((a, b) => a - b); zs.sort((a, b) => a - b); const q = (A, f) => A[Math.min(A.length - 1, Math.floor(f * A.length))], xa = q(xs, 0.03), xb = q(xs, 0.97), za = q(zs, 0.03), zb = q(zs, 0.97);
      return { cx: (xa + xb) / 2, cz: (za + zb) / 2, rx: (xb - xa) / 2, rz: (zb - za) / 2 }; };
    const yTop = height, SH = [0.058, 0.075, 0.095, 0.115, 0.135, yTop - 0.02, yTop - 0.006, yTop], rings = [], shR = [];
    let last = null; for (const y of SH) { const q = ring(Math.min(Math.max(y, 0.105), yTop - 0.01)) || last; last = q; shR.push(q); }   // the shin above the ankle bones (the foot region spans the whole foot low down)
    // a smooth shaft: radii only grow a little upward (no waist at the ankle bones), the centre a straight line
    const rx0 = Math.max(...shR.slice(0, 3).map(q => q.rx)) + 0.009, rz0 = Math.max(...shR.slice(0, 3).map(q => q.rz)) + 0.012, rxT = Math.max(rx0 - 0.004, shR[SH.length - 2].rx + 0.008), rzT = Math.max(rz0 - 0.012, shR[SH.length - 2].rz + 0.009);
    const cB = [ank.x, ank.z - 0.012], cTop = [shR[SH.length - 2].cx, shR[SH.length - 2].cz];
    SH.forEach((y, j) => { const u = (y - SH[0]) / (yTop - SH[0]), roll = j === SH.length - 1 ? -0.004 : j === SH.length - 2 ? 0.003 : 0;
      const ccx = cB[0] + (cTop[0] - cB[0]) * u, ccz = cB[1] + (cTop[1] - cB[1]) * u, rx = rx0 + (rxT - rx0) * u + roll, rz = rz0 + (rzT - rz0) * u + roll, r = [];
      for (let i = 0; i < seg; i++) { const th = i / seg * Math.PI * 2; r.push(push(U, ccx + rx * Math.cos(th), y, ccz + rz * Math.sin(th), th * rx, y)); } rings.push({ r, y, ccx, ccz, rx, rz }); });
    for (let j = 0; j + 1 < rings.length; j++) grid(U, rings[j].r, rings[j + 1].r);
    // the collar's inside: a short lining turned down 2.5 cm inside the top
    { const tp = rings[rings.length - 1], r2 = []; for (let i = 0; i < seg; i++) { const th = i / seg * Math.PI * 2; r2.push(push(U, tp.ccx + (tp.rx - 0.008) * Math.cos(th), tp.y - 0.025, tp.ccz + (tp.rz - 0.008) * Math.sin(th), th * tp.rx, tp.y - 0.025)); } grid(U, tp.r, r2); }
    // ---- the sole: the upper's outline 3 mm proud, heel block, breast, arch, toe spring; a rounded edge
    const Sx = mk(), NS = 44, srows = [];
    for (let k = 0; k <= NS; k++) { const t = k / NS, hw = W * lerpK(WF, t) + 0.003, z = zh - 0.002 + t * (L + 0.004), yt = soleTop(t), yb = soleBot(t), c0 = cxT(t);
      const pinch = t < 0.05 ? Math.sqrt(1 - ((0.05 - t) / 0.05) ** 2) : t > 0.95 ? Math.sqrt(Math.max(0, 1 - ((t - 0.95) / 0.05) ** 2)) : 1;
      // CLOTH5 (opt-in spec.toe5): the sole never narrower than the upper over it (+1.5 mm): pinched to a point at the tip, it let the upper's
      // toe, whose underside sits 3 mm into the sole, come out through the sole's sides: the dark slot at the front of every boot
      const w2 = spec.toe5 ? Math.max(0.15 * hw, hw * pinch, W * lerpK(WF, t) + 0.0015) : Math.max(0.15 * hw, hw * pinch);
      const sec = [[-w2 + 0.002, yb], [-w2, yb + 0.003], [-w2, yt - 0.0025], [-w2 + 0.0015, yt], [w2 - 0.0015, yt], [w2, yt - 0.0025], [w2, yb + 0.003], [w2 - 0.002, yb]];
      srows.push(sec.map(([x, y]) => push(Sx, c0 + x, y, z, x, z))); }
    for (let k = 0; k < NS; k++) grid(Sx, srows[k], srows[k + 1]);
    for (const [r, fw] of [[srows[0], false], [srows[NS], true]]) for (let i = 1; i < 7; i++) fw ? Sx.T.push(r[0], r[i + 1], r[i]) : Sx.T.push(r[0], r[i], r[i + 1]);   // (CLOTH5: swapped; the sole's toe cap faced in: the dark slot at the front of every boot, its heel cap too)
    // ---- the throat: a centre line from the vamp (t 0.5) up the shaft front; eyelets either side; laces crossing; a knot
    const surf = U.P, near = (x, y, z) => { let b = 0, bd = Infinity; for (let v = 0; v < surf.length / 3; v++) { const d = (surf[v * 3] - x) ** 2 + (surf[v * 3 + 1] - y) ** 2 + (surf[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; b = v; } } return b; };
    const Nrm = vnormals(U.P, U.T), front = j => { const R = rings[j]; return [R.ccx, R.y, R.ccz + R.rz]; };
    const vt = 0.5, vamp = [cxT(vt), soleTop(vt) + lerpK(HF, vt), zh + vt * L], A1 = front(2), A2 = front(rings.length - 2);
    const cl = u => { if (u < 0.45) { const s = u / 0.45; return [vamp[0] + (A1[0] - vamp[0]) * s, vamp[1] + (A1[1] - vamp[1]) * s + 0.006 * Math.sin(Math.PI * s), vamp[2] + (A1[2] - vamp[2]) * s]; } const s = (u - 0.45) / 0.55; return [A1[0] + (A2[0] - A1[0]) * s, A1[1] + (A2[1] - A1[1]) * s, A1[2] + (A2[2] - A1[2]) * s]; };
    const NE = 7, eyes = [];
    for (let i = 0; i < NE; i++) { const u = 0.04 + i / (NE - 1) * 0.92, c = cl(u), c2 = cl(Math.min(1, u + 0.02)), tg = [c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]], off = 0.0105 + 0.004 * u;
      for (const sd of [-1, 1]) { const x = c[0] + sd * off, v0 = near(x, c[1], c[2]), q = [surf[v0 * 3], surf[v0 * 3 + 1], surf[v0 * 3 + 2]], nn = [Nrm[v0 * 3], Nrm[v0 * 3 + 1], Nrm[v0 * 3 + 2]]; eyes.push({ i, sd, p: [q[0] + nn[0] * 0.0008, q[1] + nn[1] * 0.0008, q[2] + nn[2] * 0.0008], n: nn, tg }); } }
    // the eyelets: small rings (torus sections), metal
    const E = mk(); for (const e of eyes) torus(E, push, e.p, e.n, 0.0032, 0.0009, 12, 6);
    // the laces: from each eyelet to the opposite one a step up (a criss-cross), raised over the tongue; bars across at the bottom pair
    const Lc = mk(), byI = (i, sd) => eyes.find(e => e.i === i && e.sd === sd).p, lift = (a, b, up) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], nn = eyes[0].n; void nn; return m; };
    const tubeLine = (pts, r) => tube(Lc, push, pts, r, 7);
    tubeLine(arcPts(byI(0, -1), byI(0, 1), 0.0016, U.P, near, Nrm), 0.0014);
    for (let i = 0; i + 1 < NE; i++) for (const sd of [-1, 1]) tubeLine(arcPts(byI(i, sd), byI(i + 1, -sd), 0.0018, U.P, near, Nrm), 0.0014);
    // the knot at the top pair and its two ends laid down the shaft front (on the surface: under the trouser leg, in the collider)
    { const a = byI(NE - 1, -1), b = byI(NE - 1, 1), m = lift(a, b), onS = (x, y, z, off) => { const v0 = near(x, y, z); return [U.P[v0 * 3] + Nrm[v0 * 3] * off, U.P[v0 * 3 + 1] + Nrm[v0 * 3 + 1] * off, U.P[v0 * 3 + 2] + Nrm[v0 * 3 + 2] * off]; }, kn = onS(m[0], m[1], m[2], 0.0022);
      sphere(Lc, push, kn, 0.0026, 8, 6); for (const sd of [-1, 1]) tubeLine([kn, onS(kn[0] + sd * 0.008, kn[1] - 0.008, kn[2], 0.0016), onS(kn[0] + sd * 0.012, kn[1] - 0.026, kn[2], 0.0015), onS(kn[0] + sd * 0.013, kn[1] - 0.04, kn[2], 0.0015)], 0.0013); }
    // the toe-cap seam: a raised stitched line across the toe box at t ~0.8
    { const t = 0.79, pts = []; for (let i = 0; i <= 14; i++) { const th = Math.PI * (0.06 + 0.88 * i / 14), c = Math.cos(th), sn = Math.sin(th), wf = lerpK(WF, t), hh = lerpK(HF, t), x = cxT(t) + W * wf * Math.sign(c) * Math.abs(c) ** (2 / 2.5), y = soleTop(t) - 0.0015 + hh * sn ** 0.7, z = zh + (t + 0.025 * sn) * L; const v0 = near(x, y, z); pts.push([U.P[v0 * 3] + Nrm[v0 * 3] * 0.0008, U.P[v0 * 3 + 1] + Nrm[v0 * 3 + 1] * 0.0008, U.P[v0 * 3 + 2] + Nrm[v0 * 3 + 2] * 0.0008]); }
      tube(E, push, pts, 0.0009, 5); }
    // ---- meshes (the collider: upper + sole) and parts
    const geo = A => { const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.Float32BufferAttribute(A.P, 3)); G.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(A.S, 4)); G.setAttribute('skinWeight', new THREE.Float32BufferAttribute(A.W, 4));
      const ah = new Float32Array(A.P.length / 3 * 4); for (let v = 0; v < A.P.length / 3; v++) ah.set([A.P[v * 3 + 1] > 0.1 ? RG_SHIN : RG_FOOT, 2, sg, 0], v * 4); G.setAttribute('aHero', new THREE.BufferAttribute(ah, 4)); G.setIndex(A.T); G.computeVertexNormals(); return G; };
    for (const A of [U, Sx, Lc, E]) { const m = new THREE.Mesh(geo(A)); m.userData.boot4 = side; m.visible = false; meshes.push(m); }   // the laces too: the trouser leg drapes over them
    const part = (A, name, fabric, color, extra = {}) => ({ name: `boot.${name}.${side}`, X: Float64Array.from(A.P, x => x * scale), T: Int32Array.from(A.T), SI: Uint16Array.from(A.S), SW: Float32Array.from(A.W), uv: Float64Array.from(A.U, x => x * scale), fabric, color, part: 'boots', construction: 'boot', group: 'boot', sewn: 1, ...extra });
    parts.push(part(U, 'upper', 'bootLeather', col), part(Sx, 'sole', 'bootLeather', sole), part(Lc, 'laces', 'twillPC', lace), part(E, 'eyelets', 'leather', eyelet, { solid: true }));
    // measures: the shaft's top girth, the sole against the upper at the ball (the flare), heights
    const top = rings[rings.length - 2]; rep[side] = { lengthCm: +(L * scale * 100).toFixed(1), shaftTopCm: +(yTop * scale * 100).toFixed(1), shaftGirthCm: +(Math.PI * (3 * (top.rx + top.rz) - Math.sqrt((3 * top.rx + top.rz) * (top.rx + 3 * top.rz))) * scale * 100).toFixed(1),
      soleProudMm: 3, eyelets: eyes.length, tris: (U.T.length + Sx.T.length + Lc.T.length + E.T.length) / 3 };
  }
  // the c7 boots out (hidden; the collider and the girths now read these)
  for (const m of [].concat(h.cloth?.boots || [])) if (m) m.visible = false;
  h._bootsC7 = h.cloth.boots; h.cloth.boots = meshes;
  return { meshes, parts, report: rep };
}
// the laces' path between two eyelets: an arc lifted off the surface (the tongue under it)
function arcPts(a, b, up, P, near, N) { const pts = []; for (let i = 0; i <= 8; i++) { const s = i / 8, m = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s], v = near(m[0], m[1], m[2]), nn = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], q = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], d = (m[0] - q[0]) * nn[0] + (m[1] - q[1]) * nn[1] + (m[2] - q[2]) * nn[2], k = up * Math.sin(Math.PI * s) ** 0.6 + 0.0012 - Math.min(0, d);
    pts.push([m[0] + nn[0] * k, m[1] + nn[1] * k, m[2] + nn[2] * k]); } return pts; }
function vnormals(P, T) { const N = new Float64Array(P.length); for (let t = 0; t < T.length; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; } }
  for (let v = 0; v < N.length; v += 3) { const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1; N[v] /= l; N[v + 1] /= l; N[v + 2] /= l; } return N; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
// a tube along a polyline (radius r, k sides), capped
function tube(A, push, pts, r, k) { const rows = []; let prevB = null;
  for (let i = 0; i < pts.length; i++) { const tg = nrm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)])); let b = prevB ? nrm(sub(prevB, tg.map(x => x * (prevB[0] * tg[0] + prevB[1] * tg[1] + prevB[2] * tg[2])))) : nrm(crs(tg, Math.abs(tg[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); prevB = b; const c = crs(tg, b), row = [];
    for (let j = 0; j < k; j++) { const th = j / k * Math.PI * 2, o = [b[0] * Math.cos(th) + c[0] * Math.sin(th), b[1] * Math.cos(th) + c[1] * Math.sin(th), b[2] * Math.cos(th) + c[2] * Math.sin(th)]; row.push(push(A, pts[i][0] + o[0] * r, pts[i][1] + o[1] * r, pts[i][2] + o[2] * r, th * r, i * 0.004)); } rows.push(row); }
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < k; j++) { const j2 = (j + 1) % k; A.T.push(rows[i][j], rows[i][j2], rows[i + 1][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]); }
  for (const [row, p, fl] of [[rows[0], pts[0], true], [rows[rows.length - 1], pts[pts.length - 1], false]]) { const c0 = push(A, p[0], p[1], p[2]); for (let j = 0; j < k; j++) { const j2 = (j + 1) % k; fl ? A.T.push(c0, row[j2], row[j]) : A.T.push(c0, row[j], row[j2]); } } }
function torus(A, push, p, n, R, r, a, b) { const u = nrm(crs(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = crs(n, u), rows = [];
  for (let i = 0; i < a; i++) { const th = i / a * Math.PI * 2, d = [u[0] * Math.cos(th) + w[0] * Math.sin(th), u[1] * Math.cos(th) + w[1] * Math.sin(th), u[2] * Math.cos(th) + w[2] * Math.sin(th)], row = [];
    for (let j = 0; j < b; j++) { const ph = j / b * Math.PI * 2, rr = R + r * Math.cos(ph), h = r * Math.sin(ph) * 0.6; row.push(push(A, p[0] + d[0] * rr + n[0] * h, p[1] + d[1] * rr + n[1] * h, p[2] + d[2] * rr + n[2] * h, th * R, ph * r)); } rows.push(row); }
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) { const i2 = (i + 1) % a, j2 = (j + 1) % b; A.T.push(rows[i][j], rows[i2][j], rows[i][j2], rows[i][j2], rows[i2][j], rows[i2][j2]); } }
function sphere(A, push, p, r, a, b) { const rows = []; for (let j = 0; j <= b; j++) { const ph = j / b * Math.PI, row = []; for (let i = 0; i < a; i++) { const th = i / a * Math.PI * 2; row.push(push(A, p[0] + r * Math.sin(ph) * Math.cos(th), p[1] + r * Math.cos(ph), p[2] + r * Math.sin(ph) * Math.sin(th))); } rows.push(row); }
  for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) { const i2 = (i + 1) % a; A.T.push(rows[j][i], rows[j][i2], rows[j + 1][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]); } }
