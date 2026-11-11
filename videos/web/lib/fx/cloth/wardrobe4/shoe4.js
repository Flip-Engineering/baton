// SHOE4 (CLOTHING K4, the wardrobe): a second shoe beside CLOTH4's work boot (boot4.js): a low-top lace-up SNEAKER (a canvas or leather
// upper on a white rubber cupsole: the everyday shoe of a service floor, a warehouse that allows it, a weekend), built outside hero.js from
// the person's own foot as boot4 is: the same last (heel counter, waist, the ball wider on the inside, the toe line turned in, toe spring),
// cut LOW: the upper closes over the foot only to the collar height behind the throat (the leg passes out through it; a padded collar
// rolled round the ankle at that height), a tongue up the throat, 5 eyelet pairs on the vamp with flat laces crossing and a bow, a thick
// rubber sole wrapping up the sides (the foxing) and over the toe (the bumper), a heel tab. Skinned to foot / toe as the boot.
// wearShoes(h, p, spec) puts the upper + sole in h.cloth.boots (the stack's collider, the hem rests on it) in place of the c7 boots and
// returns the parts (plain data, bind metres, group 'boot': the page hides the c7 boots for any bake that carries one).
// Neutral design (no brand marks). Units: hero bind units, as hero.js and boot4.js.
import * as THREE from 'three';
import { lastUV7 } from '../fabric7/last7.js';
export const SHOE4_VERSION = 1;   // (the upper is built with the last's own coordinate and caps by arc length, a sneaker's apexes inside the sole's walls: fabric7/last7.js, FABRIC7 owns it. The runtime route for BAKED shoes is SHOES7, which applies the same function as the part is added.)
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const lerpK = (K, t) => { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const u = (t - K[i - 1][0]) / (K[i][0] - K[i - 1][0]); return K[i - 1][1] + (K[i][1] - K[i - 1][1]) * u; } return K[K.length - 1][1]; };
const RG_SHIN = 9, RG_FOOT = 10;
// the last (boot4's): half width by length (0 heel .. 1 toe); the upper's height over the sole top: low behind the throat (the collar),
// the tongue's line up the throat, the vamp and the toe box
const WF = [[0, 0.6], [0.05, 0.8], [0.16, 0.86], [0.32, 0.84], [0.5, 0.93], [0.66, 1.0], [0.78, 0.98], [0.88, 0.86], [0.95, 0.66], [0.985, 0.42], [1, 0.12]];
const HF = [[0, 0.052], [0.08, 0.05], [0.2, 0.046], [0.32, 0.05], [0.42, 0.072], [0.5, 0.068], [0.6, 0.058], [0.72, 0.05], [0.84, 0.044], [0.94, 0.036], [0.99, 0.026], [1, 0.014]];
export const SHOE4_DEFAULT = { kind: 'sneaker', color: '#e9e6df', upper: 'canvas', sole: '#efebe3', lace: '#ecebe6', eyelet: '#8d8a84', tab: null, foxing: 0.014, heel: 0.03, fore: 0.02 };

export function wearShoes(h, p, spec = {}, { scale = 1 } = {}) {
  const sp = { ...SHOE4_DEFAULT, ...spec }, I = h.idx, g = h.body.geometry, pos = g.attributes.position.array, AH = g.attributes.aHero.array, n = pos.length / 3;
  const meshes = [], parts = [], rep = {};
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let v = 0; v < n; v++) if (Math.round(AH[v * 4]) === RG_FOOT && Math.sign(pos[v * 3]) === sg) { x0 = Math.min(x0, pos[v * 3]); x1 = Math.max(x1, pos[v * 3]); z0 = Math.min(z0, pos[v * 3 + 2]); z1 = Math.max(z1, pos[v * 3 + 2]); }
    const ank = h.head0[I['foot.' + side]], toeJ = h.head0[I['toe1-1.' + side]], bF = I['foot.' + side], bT = I['toe1-1.' + side], bS = I['lowerleg02.' + side];
    const W = (x1 - x0) / 2 + 0.0065, L = z1 - z0 + 0.022, zh = z0 - 0.008, cx = (x0 + x1) / 2, toeZ = toeJ.z;
    const cxT = t => cx - sg * W * 0.11 * sstep(0.45, 1, t);
    const spring = t => 0.011 * sstep(0.8, 1, t) ** 1.4, soleTop = t => sp.fore + (sp.heel - sp.fore) * (1 - sstep(0.22, 0.4, t)) + spring(t), soleBot = t => spring(t) * 0.9;
    const wgt = (z, y) => { const wt = sstep(toeZ - 0.015, toeZ + 0.02, z), ws = sstep(0.1, 0.16, y); return [[bF, (1 - wt) * (1 - ws)], [bT, wt * (1 - ws)], [bS, ws]].filter(q => q[1] > 1e-4).sort((a, b) => b[1] - a[1]); };
    const mk = () => ({ P: [], S: [], W: [], T: [], U: [] }), push = (A, x, y, z, u = 0, w = 0) => { A.P.push(x, y, z); const q = wgt(z, y); for (let k = 0; k < 4; k++) { A.S.push(q[k] ? q[k][0] : 0); A.W.push(q[k] ? q[k][1] : 0); } A.U.push(u, w); return A.P.length / 3 - 1; };
    const grid = (A, ra, rb, closed = true) => { const m = ra.length - (closed ? 0 : 1); for (let i = 0; i < m; i++) { const i2 = (i + 1) % ra.length; A.T.push(ra[i], rb[i], ra[i2], ra[i2], rb[i], rb[i2]); } };
    // ---- the upper: superellipse sections on the last; behind the throat (t < 0.4) the top flattened to the collar height (the leg passes
    // out through it: what shows is the padded collar round the ankle and the counter below it)
    const U = mk(), NT = 26, seg = 36, rows = [];
    const secAt = (tt, i) => { const wf = lerpK(WF, tt), hh = lerpK(HF, tt), base = soleTop(tt), th = i / seg * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), flat = 1 - sstep(0.32, 0.42, tt);
      const ex = sn > 0 ? (tt > 0.6 ? 0.7 : 0.85) * (1 - flat) + 0.18 * flat : 1;
      return [cxT(tt) + W * wf * Math.sign(c) * Math.abs(c) ** 0.8, base - 0.0015 + (sn > 0 ? hh * Math.abs(sn) ** ex : 0.0015 * sn), zh + tt * L]; };
    const secAtTh = (tt, th) => secAt(tt, th / (Math.PI * 2) * seg);
    for (let k = 0; k <= NT; k++) { const t = k / NT, r = []; for (let i = 0; i < seg; i++) { const q = secAt(t, i); r.push(push(U, q[0], q[1], q[2], i / seg * Math.PI * 2 * W, q[2])); } rows.push(r); }
    for (let k = 0; k < NT; k++) grid(U, rows[k + 1], rows[k]);
    const capA = (r, fw) => { let sx = 0, sy = 0, sz = 0; for (const v of r) { sx += U.P[v * 3]; sy += U.P[v * 3 + 1]; sz += U.P[v * 3 + 2]; } const c0 = push(U, sx / r.length, sy / r.length + (fw ? -0.003 : 0), sz / r.length + (fw ? 0.003 : -0.003));
      for (let i = 0; i < r.length; i++) { const i2 = (i + 1) % r.length; fw ? U.T.push(c0, r[i], r[i2]) : U.T.push(c0, r[i2], r[i]); } };   // (boot4's caps faced inward: a dark arch at the heel)
    capA(rows[0], false); capA(rows[NT], true);
    lastUV7(U.P, U.U, U.T, null, { boot: false });   // FABRIC7: the grey disc (the apex 1.0 mm through the sole's front wall) and the toe fan (uv = theta W, apex uv (0, 0)) at their source
    // ---- the sole: the upper's outline 2.5 mm proud, a rounded edge, wrapping up the sides by `foxing` and over the toe (the bumper)
    const Sx = mk(), NS = 44, srows = [];
    for (let k = 0; k <= NS; k++) { const t = k / NS, hw = W * lerpK(WF, t) + 0.0025, z = zh - 0.002 + t * (L + 0.004), yt = soleTop(t) + sp.foxing + 0.006 * sstep(0.82, 0.97, t), yb = soleBot(t), c0 = cxT(t);
      const pinch = t < 0.05 ? Math.sqrt(1 - ((0.05 - t) / 0.05) ** 2) : t > 0.95 ? Math.sqrt(Math.max(0, 1 - ((t - 0.95) / 0.05) ** 2)) : 1, w2 = sp.toe5 ? Math.max(0.15 * hw, hw * pinch, hw - 0.001) : Math.max(0.15 * hw, hw * pinch);   // toe5 (CLOTH5, opt-in): never narrower than the upper (boot4's toe slot)
      const sec = [[-w2 + 0.003, yb], [-w2, yb + 0.004], [-w2, yt - 0.002], [-w2 + 0.0035, yt], [w2 - 0.0035, yt], [w2, yt - 0.002], [w2, yb + 0.004], [w2 - 0.003, yb]];
      srows.push(sec.map(([x, y]) => push(Sx, c0 + x, y, z, x, z))); }
    for (let k = 0; k < NS; k++) grid(Sx, srows[k], srows[k + 1]);
    for (const [r, fw] of [[srows[0], false], [srows[NS], true]]) for (let i = 1; i < 7; i++) fw ? Sx.T.push(r[0], r[i + 1], r[i]) : Sx.T.push(r[0], r[i], r[i + 1]);   // (CLOTH5: swapped, as boot4's: the caps faced in)
    // a line round the sole's wall (the moulded stripe), as a thin tube a little proud of it
    const Nrm0 = vnormals(U.P, U.T);
    // ---- the throat: eyelets either side of a centre line from the vamp (t 0.58) to the top of the throat (t 0.42), the laces crossing
    const nearU = (x, y, z) => { let b = 0, bd = Infinity; for (let v = 0; v < U.P.length / 3; v++) { const d = (U.P[v * 3] - x) ** 2 + (U.P[v * 3 + 1] - y) ** 2 + (U.P[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; b = v; } } return b; };
    const topAt = t => { const q = secAt(t, Math.round(seg / 4)); return q; };
    const NE = 5, eyes = [], E = mk(), Lc = mk();
    for (let i = 0; i < NE; i++) { const t = 0.6 - i / (NE - 1) * 0.17, c = topAt(t), off = 0.012 + 0.004 * i / (NE - 1);
      for (const sd of [-1, 1]) { const v0 = nearU(c[0] + sd * off, c[1], c[2]), q = [U.P[v0 * 3], U.P[v0 * 3 + 1], U.P[v0 * 3 + 2]], nn = [Nrm0[v0 * 3], Nrm0[v0 * 3 + 1], Nrm0[v0 * 3 + 2]]; eyes.push({ i, sd, p: [q[0] + nn[0] * 0.0006, q[1] + nn[1] * 0.0006, q[2] + nn[2] * 0.0006], n: nn }); } }
    for (const e of eyes) torus(E, push, e.p, e.n, 0.0026, 0.0008, 10, 6);
    const byI = (i, sd) => eyes.find(e => e.i === i && e.sd === sd).p;
    flatLace(Lc, push, arcPts(byI(0, -1), byI(0, 1), 0.0014, U.P, nearU, Nrm0), 0.0035, 0.0009);
    for (let i = 0; i + 1 < NE; i++) for (const sd of [-1, 1]) flatLace(Lc, push, arcPts(byI(i, sd), byI(i + 1, -sd), 0.0018, U.P, nearU, Nrm0), 0.0035, 0.0009);
    // the bow at the top pair: two loops and two ends lying on the vamp
    { const a = byI(NE - 1, -1), b = byI(NE - 1, 1), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.002, (a[2] + b[2]) / 2], v0 = nearU(m[0], m[1], m[2]), nn = [Nrm0[v0 * 3], Nrm0[v0 * 3 + 1], Nrm0[v0 * 3 + 2]], kn = [m[0] + nn[0] * 0.003, m[1] + nn[1] * 0.003, m[2] + nn[2] * 0.003];
      sphere(Lc, push, kn, 0.0028, 8, 6);
      for (const sd of [-1, 1]) { const loop = []; for (let k = 0; k <= 10; k++) { const th = k / 10 * Math.PI, r0 = 0.012; loop.push([kn[0] + sd * Math.sin(th) * r0, kn[1] + (1 - Math.cos(th)) * 0.004 - Math.sin(th) * 0.002, kn[2] + Math.sin(th) * 0.004 + 0.002]); } flatLace(Lc, push, loop, 0.0034, 0.0009);
        flatLace(Lc, push, [kn, [kn[0] + sd * 0.006, kn[1] - 0.008, kn[2] + 0.004], [kn[0] + sd * 0.009, kn[1] - 0.022, kn[2] + 0.006]], 0.0034, 0.0009); } }
    // ---- the padded collar: a soft tube round the ankle at the collar line (behind the throat), and the tongue's top edge
    // the rim of the opening: down one side's top edge from the throat to the heel, round the back, up the other side (th: the section's angle)
    const collar = []; { const NTc = 14, thS = 0.22;
      for (let k = 0; k <= NTc; k++) { const t = 0.41 - k / NTc * 0.39, q = secAtTh(t, thS); collar.push([q[0] - 0.0015, q[1] + 0.0025, q[2]]); }
      for (let k = 1; k < 10; k++) { const th = thS + (Math.PI - 2 * thS) * k / 10, q = secAtTh(0.02, th), qb = secAtTh(0.0, th); collar.push([q[0], q[1] + 0.0025, (q[2] + qb[2]) / 2]); }
      for (let k = NTc; k >= 0; k--) { const t = 0.41 - k / NTc * 0.39, q = secAtTh(t, Math.PI - thS); collar.push([q[0] + 0.0015, q[1] + 0.0025, q[2]]); } }
    tube(U, push, collar, 0.0042, 8);
    // ---- the heel tab: a small loop of webbing over the counter's top at the back
    { const q = secAt(0.02, Math.round(seg / 4)), tb = [[q[0], q[1] - 0.012, q[2] - 0.004], [q[0], q[1] + 0.004, q[2] - 0.006], [q[0], q[1] + 0.012, q[2] - 0.001]]; flatLace(E, push, tb, 0.012, 0.0012); }
    // ---- meshes (the collider: upper + sole) and parts
    const geo = A => { const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.Float32BufferAttribute(A.P, 3)); G.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(A.S, 4)); G.setAttribute('skinWeight', new THREE.Float32BufferAttribute(A.W, 4));
      const ah = new Float32Array(A.P.length / 3 * 4); for (let v = 0; v < A.P.length / 3; v++) ah.set([A.P[v * 3 + 1] > 0.1 ? RG_SHIN : RG_FOOT, 2, sg, 0], v * 4); G.setAttribute('aHero', new THREE.BufferAttribute(ah, 4)); G.setIndex(A.T); G.computeVertexNormals(); return G; };
    for (const A of [U, Sx]) { const m = new THREE.Mesh(geo(A)); m.userData.shoe4 = side; m.visible = false; meshes.push(m); }
    const part = (A, name, fabric, color, extra = {}) => ({ name: `shoe.${name}.${side}`, X: Float64Array.from(A.P, x => x * scale), T: Int32Array.from(A.T), SI: Uint16Array.from(A.S), SW: Float32Array.from(A.W), uv: Float64Array.from(A.U, x => x * scale), fabric, color, part: 'boots', construction: 'shoe', group: 'boot', sewn: 1, ...extra });
    parts.push(part(U, 'upper', sp.upper, sp.color), part(Sx, 'sole', 'bootLeather', sp.sole, { solid: true }), part(Lc, 'laces', 'teeJersey', sp.lace), part(E, 'eyelets', 'leather', sp.eyelet, { solid: true }));
    rep[side] = { lengthCm: +(L * scale * 100).toFixed(1), collarCm: +((soleTop(0.1) + lerpK(HF, 0.1)) * scale * 100).toFixed(1), soleHeelCm: +(sp.heel * scale * 100).toFixed(1), eyelets: eyes.length, tris: (U.T.length + Sx.T.length + Lc.T.length + E.T.length) / 3 };
  }
  for (const m of [].concat(h.cloth?.boots || [])) if (m) m.visible = false;
  h._bootsC7 = h._bootsC7 || h.cloth.boots; h.cloth.boots = meshes;
  return { meshes, parts, report: rep };
}
function arcPts(a, b, up, P, near, N) { const pts = []; for (let i = 0; i <= 8; i++) { const s = i / 8, m = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s], v = near(m[0], m[1], m[2]), nn = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], q = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], d = (m[0] - q[0]) * nn[0] + (m[1] - q[1]) * nn[1] + (m[2] - q[2]) * nn[2], k = up * Math.sin(Math.PI * s) ** 0.6 + 0.0012 - Math.min(0, d);
    pts.push([m[0] + nn[0] * k, m[1] + nn[1] * k, m[2] + nn[2] * k]); } return pts; }
function vnormals(P, T) { const N = new Float64Array(P.length); for (let t = 0; t < T.length; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; } }
  for (let v = 0; v < N.length; v += 3) { const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1; N[v] /= l; N[v + 1] /= l; N[v + 2] /= l; } return N; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
function tube(A, push, pts, r, k) { const rows = []; let prevB = null;
  for (let i = 0; i < pts.length; i++) { const tg = nrm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)])); const b = prevB ? nrm(sub(prevB, tg.map(x => x * (prevB[0] * tg[0] + prevB[1] * tg[1] + prevB[2] * tg[2])))) : nrm(crs(tg, Math.abs(tg[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); prevB = b; const c = crs(tg, b), row = [];
    for (let j = 0; j < k; j++) { const th = j / k * Math.PI * 2, o = [b[0] * Math.cos(th) + c[0] * Math.sin(th), b[1] * Math.cos(th) + c[1] * Math.sin(th), b[2] * Math.cos(th) + c[2] * Math.sin(th)]; row.push(push(A, pts[i][0] + o[0] * r, pts[i][1] + o[1] * r, pts[i][2] + o[2] * r, th * r, i * 0.004)); } rows.push(row); }
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < k; j++) { const j2 = (j + 1) % k; A.T.push(rows[i][j], rows[i][j2], rows[i + 1][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]); }
  for (const [row, p, fl] of [[rows[0], pts[0], true], [rows[rows.length - 1], pts[pts.length - 1], false]]) { const c0 = push(A, p[0], p[1], p[2]); for (let j = 0; j < k; j++) { const j2 = (j + 1) % k; fl ? A.T.push(c0, row[j2], row[j]) : A.T.push(c0, row[j], row[j2]); } } }
// a flat lace (a ribbon w wide, t thick: a box section) along a polyline
function flatLace(A, push, pts, w, t) { const rows = []; for (let i = 0; i < pts.length; i++) { const tg = nrm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)])), up = nrm(crs(crs(tg, [0, 1, 0]), tg)), sd = nrm(crs(tg, up)), q = pts[i], row = [];
    for (const [a, b] of [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]]) row.push(push(A, q[0] + sd[0] * a + up[0] * b, q[1] + sd[1] * a + up[1] * b, q[2] + sd[2] * a + up[2] * b, a, i * 0.004)); rows.push(row); }
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < 4; j++) { const j2 = (j + 1) % 4; A.T.push(rows[i][j], rows[i + 1][j], rows[i][j2], rows[i][j2], rows[i + 1][j], rows[i + 1][j2]); } }
function torus(A, push, p, n, R, r, a, b) { const u = nrm(crs(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = crs(n, u), rows = [];
  for (let i = 0; i < a; i++) { const th = i / a * Math.PI * 2, d = [u[0] * Math.cos(th) + w[0] * Math.sin(th), u[1] * Math.cos(th) + w[1] * Math.sin(th), u[2] * Math.cos(th) + w[2] * Math.sin(th)], row = [];
    for (let j = 0; j < b; j++) { const ph = j / b * Math.PI * 2, rr = R + r * Math.cos(ph), hh = r * Math.sin(ph) * 0.6; row.push(push(A, p[0] + d[0] * rr + n[0] * hh, p[1] + d[1] * rr + n[1] * hh, p[2] + d[2] * rr + n[2] * hh, th * R, ph * r)); } rows.push(row); }
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) { const i2 = (i + 1) % a, j2 = (j + 1) % b; A.T.push(rows[i][j], rows[i2][j], rows[i][j2], rows[i][j2], rows[i2][j], rows[i2][j2]); } }
function sphere(A, push, p, r, a, b) { const rows = []; for (let j = 0; j <= b; j++) { const ph = j / b * Math.PI, row = []; for (let i = 0; i < a; i++) { const th = i / a * Math.PI * 2; row.push(push(A, p[0] + r * Math.sin(ph) * Math.cos(th), p[1] + r * Math.cos(ph), p[2] + r * Math.sin(ph) * Math.sin(th))); } rows.push(row); }
  for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) { const i2 = (i + 1) % a; A.T.push(rows[j][i], rows[j][i2], rows[j + 1][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]); } }
