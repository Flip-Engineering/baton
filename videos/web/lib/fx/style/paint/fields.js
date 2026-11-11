// STYLE c2 / S2 PAINT: the fields a painter reads off the anatomy, as per-vertex attributes on a BUILT hero (from outside: nothing in
// hero.js, lane A, lane E or lane D changes). Every painted, sculpted or cut style in this folder draws from these, in BIND space, so
// what is drawn on the body rides the skinning and never swims when the person moves or the camera does.
//
//   import { loadAnatomy, paintFields } from '../lib/fx/style/paint/fields.js';
//   const A = await loadAnatomy();                 // lane A's 25 muscle bellies, its bone relief, its 66 landmarks (assets/body/basis.*)
//   const F = paintFields(h, A);                   // aPtD (stroke direction, bind, unit, tangent) + aPtM [dominant muscle id, its weight
//                                                  // (or -bone where bone lies under the skin), cavity, brush level 0..1] on h.body and
//                                                  // every mesh in h.group; returns a report
//
// The DIRECTION FIELD (the way a figure painter lays a stroke, Hale's and Bridgman's 'direction of the form'):
//   muscles   lane A's bellies (scripts/bake_body.py: Scheepers et al. 1997 origin-insertion bellies): the fibre direction. Fan muscles
//             (deltoid, pectoralis, latissimus, trapezius, gluteus maximus) converge on their insertion, a point on the bone found from
//             the joint centres (the deltoid tuberosity at 0.45 of the humerus ...); the others run along their own long axis (the
//             principal axis of the field, weighted). Blended by the field strength.
//   limbs     the dominant bone's axis (h.rig.dir: head to the next joint), so strokes run down the forearm and the shin.
//   head, trunk where no muscle: across the form (around the egg and the barrel of the ribcage: the cross-contour of the engravers).
//   garments  the axis of the bone they ride on (a sleeve along the arm, a trouser leg along the leg); hair cards along the strand
//             (the longer of the two uv derivatives of each triangle).
//   Axial (d and -d are the same stroke): smoothed on the mesh with sign alignment, projected to the tangent plane.
// CAVITY: the mesh's own concavity (the mean of the k-ring minus the vertex, along the normal), signed: + in a crease, - on a crown.
// BONE: lane A's 'bone' relief fields (clavicle, crest, patella, tibia, malleoli, C7, scapular spine ...): where bone is under skin.
import * as THREE from 'three';

// lane A's muscle names (basis.json fields of kind 'muscle'), the plate names an anatomy plate prints (Albinus / Gray), and how the
// fibres run: 'fan' to an insertion on a bone (from the joint centres), else the field's own long axis
export const MUSCLES = [
  ['deltoid', 'deltoideus', 'fan'], ['pectoral', 'pectoralis major', 'fan'], ['trapUpper', 'trapezius (upper)', 'fan'], ['trapMid', 'trapezius (middle)', 'fan'],
  ['trapLower', 'trapezius (lower)', 'axis'], ['latissimus', 'latissimus dorsi', 'fan'], ['erector', 'erector spinae', 'axis'], ['rectusAbd', 'rectus abdominis', 'axis'],
  ['oblique', 'obliquus externus', 'oblique'], ['serratus', 'serratus anterior', 'axis'], ['gluteMax', 'gluteus maximus', 'fan'], ['gluteMed', 'gluteus medius', 'axis'],
  ['biceps', 'biceps brachii', 'axis'], ['triceps', 'triceps brachii', 'axis'], ['forearmExt', 'brachioradialis, extensors', 'axis'], ['forearmFlex', 'flexors of the wrist', 'axis'],
  ['rectusFem', 'rectus femoris', 'axis'], ['vastusLat', 'vastus lateralis', 'axis'], ['vastusMed', 'vastus medialis', 'axis'], ['adductors', 'adductors', 'axis'],
  ['hamstrings', 'hamstrings', 'axis'], ['gastroc', 'gastrocnemius', 'axis'], ['soleus', 'soleus', 'axis'], ['tibialisAnt', 'tibialis anterior', 'axis'], ['scm', 'sternocleidomastoid', 'axis'],
];
export const MUSCLE_ID = Object.fromEntries(MUSCLES.map(([k], i) => [k, i + 1]));      // 0 = no muscle
const REG = { head: 0, neck: 1, torso: 2, uarm: 3, farm: 4, hand: 5, finger: 6, pelvis: 7, thigh: 8, shin: 9, foot: 10, jaw: 11 };

let _A = null;
// field format (bake_body.py pack()): k uint16 vertex ids, padded to 4 bytes, then k int16 values times the field's scale
function decodeField(bb, t) { const ix = new Uint16Array(bb, t.o, t.k), q = new Int16Array(bb, t.o + ((t.k * 2 + 3) & ~3), t.k), f = new Float32Array(t.k); for (let i = 0; i < t.k; i++) f[i] = q[i] * t.s; return { ix, f }; }
export async function loadAnatomy({ base = new URL('../../../../assets/body/', import.meta.url).href } = {}) {
  if (_A) return _A;
  const [bm, bb] = await Promise.all([fetch(base + 'basis.json').then(r => r.json()), fetch(base + 'basis.bin').then(r => r.arrayBuffer())]);
  const muscles = {}, bones = {};
  for (const [nm, t] of Object.entries(bm.fields)) {
    if (t.kind === 'muscle') muscles[nm] = { ...decodeField(bb, t), note: t.note, group: t.group };
    else if (t.kind === 'relief' && (t.mode || 'bone') === 'bone') bones[nm] = { ...decodeField(bb, t), note: t.note }; }
  return (_A = { n: bm.n, muscles, bones, landmarks: { ...bm.landmarks }, source: 'assets/body/basis.{json,bin} (HUMAN c8 lane A, CC0)' });
}

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
// vertex adjacency (CSR) from an index buffer (or a non-indexed triangle list)
function adjacency(g) {
  const n = g.attributes.position.count, I = g.index ? g.index.array : null, nt = I ? I.length / 3 : n / 3, tri = k => I ? I[k] : k;
  const deg = new Int32Array(n + 1);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) { deg[tri(t * 3 + e) + 1] += 2; }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const adj = new Int32Array(deg[n]), fill = deg.slice(0, n);
  for (let t = 0; t < nt; t++) { const a = tri(t * 3), b = tri(t * 3 + 1), c = tri(t * 3 + 2); adj[fill[a]++] = b; adj[fill[a]++] = c; adj[fill[b]++] = a; adj[fill[b]++] = c; adj[fill[c]++] = a; adj[fill[c]++] = b; }
  return { off: deg, adj, n };
}
// smooth an axial unit field in place (sign-aligned to each vertex's own), keep it tangent to N
function smoothAxial(D, N, A, it = 4, keep = 0.35) {
  const n = A.n, T = new Float32Array(n * 3);
  for (let k = 0; k < it; k++) {
    for (let v = 0; v < n; v++) { let x = D[v * 3] * keep, y = D[v * 3 + 1] * keep, z = D[v * 3 + 2] * keep;
      for (let j = A.off[v]; j < A.off[v + 1]; j++) { const u = A.adj[j], s = D[u * 3] * D[v * 3] + D[u * 3 + 1] * D[v * 3 + 1] + D[u * 3 + 2] * D[v * 3 + 2] < 0 ? -1 : 1; x += s * D[u * 3]; y += s * D[u * 3 + 1]; z += s * D[u * 3 + 2]; }
      T[v * 3] = x; T[v * 3 + 1] = y; T[v * 3 + 2] = z; }
    for (let v = 0; v < n; v++) tangentUnit(T, N, v, D); }
}
function tangentUnit(S, N, v, out) {
  let x = S[v * 3], y = S[v * 3 + 1], z = S[v * 3 + 2]; const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2], d = x * nx + y * ny + z * nz;
  x -= d * nx; y -= d * ny; z -= d * nz; let l = Math.hypot(x, y, z);
  if (l < 1e-6) { // degenerate: any tangent (across the up axis)
    x = -nz; y = 0; z = nx; l = Math.hypot(x, y, z); if (l < 1e-6) { x = 1; y = 0; z = 0; l = 1; } }
  out[v * 3] = x / l; out[v * 3 + 1] = y / l; out[v * 3 + 2] = z / l;
}
// concavity along the normal over ~ring r (a scalar per vertex, bind units), normalised to the mesh's own edge length
function cavity(P, N, A, rings = 3) {
  const n = A.n; let M = Float32Array.from(P), T = new Float32Array(n * 3); let el = 0, ec = 0;
  for (let v = 0; v < n; v += 7) for (let j = A.off[v]; j < A.off[v + 1]; j++) { const u = A.adj[j]; el += Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]); ec++; }
  el = el / Math.max(1, ec) || 0.01;
  for (let k = 0; k < rings; k++) { for (let v = 0; v < n; v++) { const a = A.off[v], b = A.off[v + 1], m = b - a; if (!m) { T[v * 3] = M[v * 3]; T[v * 3 + 1] = M[v * 3 + 1]; T[v * 3 + 2] = M[v * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0; for (let j = a; j < b; j++) { const u = A.adj[j]; x += M[u * 3]; y += M[u * 3 + 1]; z += M[u * 3 + 2]; }
      T[v * 3] = 0.5 * M[v * 3] + 0.5 * x / m; T[v * 3 + 1] = 0.5 * M[v * 3 + 1] + 0.5 * y / m; T[v * 3 + 2] = 0.5 * M[v * 3 + 2] + 0.5 * z / m; } [M, T] = [T, M]; }
  const C = new Float32Array(n);
  for (let v = 0; v < n; v++) C[v] = ((M[v * 3] - P[v * 3]) * N[v * 3] + (M[v * 3 + 1] - P[v * 3 + 1]) * N[v * 3 + 1] + (M[v * 3 + 2] - P[v * 3 + 2]) * N[v * 3 + 2]) / (el * rings * 0.5);
  return C;
}
function normalsOf(g) { if (!g.attributes.normal) g.computeVertexNormals(); return g.attributes.normal.array; }
// the bone axis per bone (bind), unit: h.rig.dir (head to the next joint for the long bones), else head -> tail
function boneAxes(h) { return h.rig && h.rig.dir ? h.rig.dir : h.head0.map((hd, i) => h.tail0[i].clone().sub(hd).normalize()); }
const dominant = (SI, SW, v) => { let b = SI[v * 4], w = SW[v * 4]; for (let k = 1; k < 4; k++) if (SW[v * 4 + k] > w) { w = SW[v * 4 + k]; b = SI[v * 4 + k]; } return b; };

// the brush level by region (0 the body's brush, 0.5 a smaller one, 1 the finest: face, hands), smoothed so the step follows a curve
const BRUSH = { 0: 1, 11: 1, 5: 1, 6: 1, 1: 0.5, 10: 0.5 };
// the stroke field of the BODY: muscles, limb axes, cross-contour; aPtM: [muscle id, muscle weight | -bone, cavity, brush level]
function bodyField(h, A) {
  const g = h.body.geometry, n = g.attributes.position.count, P = g.attributes.position.array, N = normalsOf(g), AH = h.aHero || (g.attributes.aHero && g.attributes.aHero.array);
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, AX = boneAxes(h), I = h.idx;
  const S = new Float32Array(n * 3), D = new Float32Array(n * 3), M = new Float32Array(n * 4);
  const up = AX[I.head] || new THREE.Vector3(0, 1, 0), spine = AX[I.spine03 ?? I.spine02 ?? I.root] || up;
  // 1. the default: limbs along the bone, head / jaw / trunk across the form
  for (let v = 0; v < n; v++) {
    const r = AH ? Math.round(AH[v * 4]) : -1, b = dominant(SI, SW, v), nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let a;
    if (r === REG.head || r === REG.jaw || r === REG.torso || r === REG.pelvis) { const u = r === REG.torso || r === REG.pelvis ? spine : up; a = [u.y * nz - u.z * ny, u.z * nx - u.x * nz, u.x * ny - u.y * nx]; }   // across: up x n
    else { const d = AX[b] || up; a = [d.x, d.y, d.z]; }
    S[v * 3] = a[0]; S[v * 3 + 1] = a[1]; S[v * 3 + 2] = a[2]; tangentUnit(S, N, v, D);
  }
  const Adj = adjacency(g); smoothAxial(D, N, Adj, 3);
  // 2. muscles (only when the body shares lane A's topology: original vertex ids < A.n)
  let used = 0; const rep = {};
  if (A && A.muscles) {
    const W = new Float32Array(n), MS = new Float32Array(n * 3);   // summed weight, summed (sign-aligned) muscle direction
    const H = (k) => h.head0[I[k]], lerp = (a, b, t) => a.clone().lerp(b, t);
    const ins = (nm, s) => { const ua = H('upperarm01.' + s), la = H('lowerarm01.' + s), ul = H('upperleg01.' + s), ll = H('lowerleg01.' + s);
      if (!ua || !ul) return null;
      return { deltoid: lerp(ua, la, 0.45), pectoral: lerp(ua, la, 0.18), latissimus: lerp(ua, la, 0.16), trapUpper: lerp(H('clavicle.' + s) || ua, ua, 0.85), trapMid: lerp(H('clavicle.' + s) || ua, ua, 0.7), gluteMax: lerp(ul, ll, 0.22) }[nm] || null; };
    for (const [nm, , kind] of MUSCLES) {
      const F = A.muscles[nm]; if (!F) continue; const id = MUSCLE_ID[nm];
      let mx = 0; for (let k = 0; k < F.f.length; k++) mx = Math.max(mx, F.f[k]); if (mx <= 0) continue;
      // per side: weighted centroid and principal axis (power iteration on the weighted covariance)
      for (const sgn of [1, -1]) {
        const s = sgn > 0 ? 'L' : 'R'; let sw = 0, cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < F.ix.length; k++) { const v = F.ix[k]; if (v >= n || (P[v * 3] > 0 ? 1 : -1) !== sgn && Math.abs(P[v * 3]) > 0.004) continue; const w = F.f[k] / mx; if (w <= 0.05) continue; sw += w; cx += w * P[v * 3]; cy += w * P[v * 3 + 1]; cz += w * P[v * 3 + 2]; }
        if (sw <= 0) continue; cx /= sw; cy /= sw; cz /= sw;
        const C = [0, 0, 0, 0, 0, 0];   // xx xy xz yy yz zz
        for (let k = 0; k < F.ix.length; k++) { const v = F.ix[k]; if (v >= n || (P[v * 3] > 0 ? 1 : -1) !== sgn && Math.abs(P[v * 3]) > 0.004) continue; const w = F.f[k] / mx; if (w <= 0.05) continue;
          const x = P[v * 3] - cx, y = P[v * 3 + 1] - cy, z = P[v * 3 + 2] - cz; C[0] += w * x * x; C[1] += w * x * y; C[2] += w * x * z; C[3] += w * y * y; C[4] += w * y * z; C[5] += w * z * z; }
        let ax = [0.2, 1, 0.1]; for (let it = 0; it < 30; it++) { const x = C[0] * ax[0] + C[1] * ax[1] + C[2] * ax[2], y = C[1] * ax[0] + C[3] * ax[1] + C[4] * ax[2], z = C[2] * ax[0] + C[4] * ax[1] + C[5] * ax[2], l = Math.hypot(x, y, z) || 1; ax = [x / l, y / l, z / l]; }
        // the external oblique: down and forward ('hands in the pockets'): its long axis tipped toward the midline at the front
        if (kind === 'oblique') { ax = [-sgn * 0.55, -0.75, 0.35]; const l = Math.hypot(...ax); ax = ax.map(c => c / l); }
        const iv = kind === 'fan' ? ins(nm, s) : null;
        for (let k = 0; k < F.ix.length; k++) { const v = F.ix[k]; if (v >= n || (P[v * 3] > 0 ? 1 : -1) !== sgn && Math.abs(P[v * 3]) > 0.004) continue; const w = F.f[k] / mx; if (w <= 0.04) continue;
          let d = ax; if (iv) { const x = iv.x - P[v * 3], y = iv.y - P[v * 3 + 1], z = iv.z - P[v * 3 + 2], l = Math.hypot(x, y, z); if (l > 1e-4) d = [x / l * 0.8 + ax[0] * 0.2, y / l * 0.8 + ax[1] * 0.2, z / l * 0.8 + ax[2] * 0.2]; }
          const sa = d[0] * MS[v * 3] + d[1] * MS[v * 3 + 1] + d[2] * MS[v * 3 + 2] < 0 ? -1 : 1;
          MS[v * 3] += sa * w * d[0]; MS[v * 3 + 1] += sa * w * d[1]; MS[v * 3 + 2] += sa * w * d[2]; W[v] += w;
          if (w > M[v * 4 + 1]) { M[v * 4] = id; M[v * 4 + 1] = w; } }
        used++; rep[nm] = (rep[nm] || 0) + 1;
      }
    }
    // blend: muscle direction where the bellies are, the default elsewhere
    const T = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { const w = clamp(W[v] * 1.6); if (w <= 0) { T[v * 3] = D[v * 3]; T[v * 3 + 1] = D[v * 3 + 1]; T[v * 3 + 2] = D[v * 3 + 2]; continue; }
      const l = Math.hypot(MS[v * 3], MS[v * 3 + 1], MS[v * 3 + 2]) || 1, mx = MS[v * 3] / l, my = MS[v * 3 + 1] / l, mz = MS[v * 3 + 2] / l, sa = mx * D[v * 3] + my * D[v * 3 + 1] + mz * D[v * 3 + 2] < 0 ? -1 : 1;
      T[v * 3] = D[v * 3] * (1 - w) + sa * mx * w; T[v * 3 + 1] = D[v * 3 + 1] * (1 - w) + sa * my * w; T[v * 3 + 2] = D[v * 3 + 2] * (1 - w) + sa * mz * w; }
    for (let v = 0; v < n; v++) tangentUnit(T, N, v, D);
    smoothAxial(D, N, Adj, 2, 0.6);
  }
  // 3. bone under the skin (lane A's 'bone' relief): where it beats the muscle, the weight goes negative; cavity; brush level
  if (A && A.bones) { const B = new Float32Array(n);
    for (const F of Object.values(A.bones)) { let mx = 0; for (let k = 0; k < F.f.length; k++) mx = Math.max(mx, Math.abs(F.f[k])); if (!mx) continue;
      for (let k = 0; k < F.ix.length; k++) { const v = F.ix[k]; if (v < n && F.f[k] > 0) B[v] = Math.max(B[v], F.f[k] / mx); } }
    for (let v = 0; v < n; v++) if (B[v] > 0.25 && B[v] > M[v * 4 + 1]) M[v * 4 + 1] = -B[v]; }
  const C = cavity(P, N, Adj, 3); for (let v = 0; v < n; v++) M[v * 4 + 2] = C[v];
  let T = new Float32Array(n), T2 = new Float32Array(n); for (let v = 0; v < n; v++) T[v] = AH ? (BRUSH[Math.round(AH[v * 4])] ?? 0) : 0;
  for (let it = 0; it < 6; it++) { for (let v = 0; v < n; v++) { let s = T[v], c = 1; for (let j = Adj.off[v]; j < Adj.off[v + 1]; j++) { s += T[Adj.adj[j]]; c++; } T2[v] = s / c; } [T, T2] = [T2, T]; }
  for (let v = 0; v < n; v++) M[v * 4 + 3] = T[v];
  return { D, M, muscles: used, rep };
}
// any other mesh: the dominant bone's axis (garments), the strand (hair cards), and cavity
function otherField(h, m) {
  const g = m.geometry, n = g.attributes.position.count, P = g.attributes.position.array, N = normalsOf(g), AX = boneAxes(h), hair = m.userData.part === 'hair8' || /hair|brow|lash|beard/.test(m.userData.hairPart || '');
  const S = new Float32Array(n * 3), D = new Float32Array(n * 3), M = new Float32Array(n * 4);
  const SI = g.attributes.skinIndex && g.attributes.skinIndex.array, SW = g.attributes.skinWeight && g.attributes.skinWeight.array, head = h.idx.head;
  if (hair && g.attributes.uv) {   // along the card: the longer of dP/du and dP/dv per triangle
    const UV = g.attributes.uv.array, I = g.index ? g.index.array : null, nt = I ? I.length / 3 : n / 3, t3 = k => I ? I[k] : k;
    for (let t = 0; t < nt; t++) { const a = t3(t * 3), b = t3(t * 3 + 1), c = t3(t * 3 + 2);
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const du1 = UV[b * 2] - UV[a * 2], dv1 = UV[b * 2 + 1] - UV[a * 2 + 1], du2 = UV[c * 2] - UV[a * 2], dv2 = UV[c * 2 + 1] - UV[a * 2 + 1], det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) continue;
      const Pu = [0, 1, 2].map(i => (e1[i] * dv2 - e2[i] * dv1) / det), Pv = [0, 1, 2].map(i => (e2[i] * du1 - e1[i] * du2) / det), lu = Math.hypot(...Pu), lv = Math.hypot(...Pv), d = lv >= lu ? Pv : Pu;
      for (const v of [a, b, c]) { const s = d[0] * S[v * 3] + d[1] * S[v * 3 + 1] + d[2] * S[v * 3 + 2] < 0 ? -1 : 1; S[v * 3] += s * d[0]; S[v * 3 + 1] += s * d[1]; S[v * 3 + 2] += s * d[2]; } }
  } else for (let v = 0; v < n; v++) { const b = SI && SW ? dominant(SI, SW, v) : head, d = AX[b] || AX[head]; S[v * 3] = d.x; S[v * 3 + 1] = d.y; S[v * 3 + 2] = d.z; }
  for (let v = 0; v < n; v++) tangentUnit(S, N, v, D);
  let C = null; if (g.index && n < 400000) { const Adj = adjacency(g); if (!hair) smoothAxial(D, N, Adj, 2); C = cavity(P, N, Adj, 2); }
  const lvl = hair ? 0.5 : m.userData.part === 'eyes' || m === h.eyes || /glove|hand/.test(m.userData.part || '') ? 1 : 0;
  for (let v = 0; v < n; v++) { M[v * 4 + 2] = C ? C[v] : 0; M[v * 4 + 3] = lvl; }
  return { D, M };
}

// install aPtD / aPtM on h.body and every mesh of the hero (idempotent per geometry); returns a small report
export function paintFields(h, A = null, { force = false } = {}) {
  const t0 = performance.now(), rep = { meshes: 0, body: null };
  const put = (g, F) => { g.setAttribute('aPtD', new THREE.BufferAttribute(F.D, 3)); g.setAttribute('aPtM', new THREE.BufferAttribute(F.M, 4)); };
  if (force || !h.body.geometry.attributes.aPtD) { const F = bodyField(h, A); put(h.body.geometry, F); rep.body = { muscles: F.muscles, n: h.body.geometry.attributes.position.count }; }
  h.group.traverse(m => { if (!m.isMesh || m === h.body || !m.geometry || !m.geometry.attributes.position) return; if (!force && m.geometry.attributes.aPtD) return;
    put(m.geometry, otherField(h, m)); rep.meshes++; });
  rep.ms = Math.round(performance.now() - t0); h._paintFields = rep; return rep;
}
