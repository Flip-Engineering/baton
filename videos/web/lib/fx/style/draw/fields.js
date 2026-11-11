// STYLE c2 / S1 (drawn and printed from the anatomy): the person's DRAWING FIELDS, per vertex, in bind space.
// A stroke drawn from these sits where a figure artist puts it and is carried by the skinning, so it never swims when the
// person walks or the camera moves (the strokes are ON the body, not on the screen).
//
//   import { loadDrawAnatomy, drawFields } from '../lib/fx/style/draw/fields.js';
//   const A = await loadDrawAnatomy();          // lane A's 25 muscle fields + their lines of action, mapped to vertex ids
//   drawFields(h, A);                            // sets aDr0 / aDr1 on h.body and every garment, hair, eye and hat geometry
//
// What each vertex carries (metres in the person's own bind, so lines are spaced in body units, not pixels):
//   aDr0.x  CROSS-CONTOUR phase: distance along the axis of the vertex's chain (trunk: height; arm: wrist -> shoulder;
//           leg: ankle -> hip; foot: toes -> ankle, each starting at its root joint's height; joint centres from the person's own skeleton). Its level sets are plane
//           sections across the form: Bridgman's and every life-drawing teacher's cross-contour lines.
//   aDr0.y  ALONG-THE-FORM phase: the angle round the chain's axis times a fixed radius (lines running down the limb, round
//           the trunk); the radius is chosen so 2 pi r is a whole number of the coarsest spacing (no seam at the back).
//   aDr0.z  FIBRE phase: inside the vertex's dominant muscle (lane A's fields, basis.bin), the family of plane sections that
//           runs from ORIGIN to INSERTION: parallel planes for a strap muscle (rectus, sartorius-like bellies), a pencil of
//           planes through the insertion for a fan (pectoral, deltoid, latissimus): Vesalius' and Albinus' hatching.
//   aDr0.w  fibre weight: the dominant field's strength, faded to 0 at the borders between muscles (a triangle across a
//           border would interpolate two muscles' phases: the line breaks there, as it does on an anatomical plate).
//   aDr1.x  chain purity (1 = one chain; it falls in the shoulder, groin and neck where chains blend: cross-contour fades there)
//   aDr1.y  face weight (head and jaw regions, smoothed), aDr1.z hand weight (hands and fingers), aDr1.w foot weight (-1: the eyes)
// The diagonal (third) family is one fixed tilted plane family in bind space, computed in the shader.
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const NB = 13380;                         // hm08 body vertices (helpers follow): lane A's bake
export const DR_COARSE = 1 / 1024 * 64;   // the coarsest octave the shader blends to (m); 2 pi r = j x this, so no seam
// the sections are BOWLS, not planes: u drops by BOWL x r^2 / R away from the chain's axis, so a ring reads as an arc seen from a
// little above (the engraver's and Bridgman's curved cross-contour), not a straight stripe under a level camera
export const BOWL = 0.45;
export const R_TRUNK = 14 * DR_COARSE / (2 * Math.PI), R_LIMB = 5 * DR_COARSE / (2 * Math.PI), R_FOOT = 4 * DR_COARSE / (2 * Math.PI);

// ---------------------------------------------------------------- lane A's muscles, their lines of action
// The origins and insertions are lane A's (scripts/bake_body.py, MUSCLES; HUMAN c8 lane A, CC0), on the base mesh (metres,
// feet at 0, the 1.666 m hm08 base), left side; mapped once to the nearest base vertex and read on each person's own bind, so
// they follow the person's proportions. Two are OURS (the bellies lane A authored for volume run along the muscle; the
// fibres of these two do not): the external oblique runs down and forward (the 'hands in pockets' line), the serratus'
// digitations run forward and down from the scapula's border.
function muscleTable(J, LM) {
  const v = a => new THREE.Vector3(...a), sh = J('upperarm01.L'), el = J('lowerarm01.L'), wr = J('wrist.L');
  const ae = el.clone().sub(sh).normalize(); let lat = v([-ae.y, ae.x, 0]); if (lat.y <= 0) lat.negate();
  const at = (a, b, t) => a.clone().lerp(b, t), add = (p, d) => p.clone().add(v(d));
  return [
    { name: 'deltoid', fan: true, O: [v([0.13, 1.372, 0.05]), v([0.188, 1.381, 0.009]), v([0.14, 1.365, -0.045])], I: at(sh, el, 0.45).addScaledVector(lat, 0.015) },
    { name: 'pectoral', fan: true, O: [v([0.012, 1.33, 0.09]), v([0.018, 1.27, 0.12]), v([0.022, 1.215, 0.14]), v([0.06, 1.352, 0.07])], I: add(LM('axillaFrontL'), [0.02, 0, 0]) },
    { name: 'trapUpper', O: [v([0.02, 1.47, -0.03])], I: v([0.125, 1.385, -0.005]) },
    { name: 'trapMid', O: [v([0.0, 1.35, -0.05])], I: v([0.13, 1.36, -0.04]) },
    { name: 'trapLower', O: [v([0.0, 1.21, -0.04])], I: v([0.075, 1.32, -0.05]) },
    { name: 'latissimus', fan: true, O: [v([0.02, 1.08, -0.05]), v([0.07, 1.0, -0.06]), v([0.03, 1.17, -0.06])], I: v([0.13, 1.245, -0.02]) },
    { name: 'erector', O: [v([0.03, 0.95, -0.06])], I: v([0.03, 1.28, -0.05]) },
    { name: 'rectusAbd', O: [v([0.035, 0.885, 0.1])], I: v([0.05, 1.19, 0.14]) },
    { name: 'oblique', O: [v([0.14, 1.12, 0.0])], I: v([0.06, 0.95, 0.1]), ours: 'fibre direction: down and forward' },
    { name: 'serratus', O: [v([0.125, 1.24, 0.0])], I: v([0.11, 1.15, 0.06]), ours: 'fibre direction: forward and down' },
    { name: 'gluteMax', O: [v([0.035, 0.93, -0.07])], I: v([0.15, 0.78, -0.04]) },
    { name: 'gluteMed', O: [v([0.12, 0.99, -0.01])], I: v([0.165, 0.87, -0.01]) },
    { name: 'biceps', O: [add(sh, [0, -0.03, 0.03])], I: add(el, [0, 0.015, 0.03]) },
    { name: 'triceps', O: [add(sh, [0, -0.02, -0.03])], I: add(LM('olecranonL'), [0, 0.02, 0]) },
    { name: 'forearmExt', O: [LM('latEpicondyleL')], I: at(el, wr, 0.55).addScaledVector(lat, 0.02) },
    { name: 'forearmFlex', O: [LM('medEpicondyleL')], I: at(el, wr, 0.55).addScaledVector(lat, -0.02) },
    { name: 'rectusFem', O: [v([0.11, 0.83, 0.07])], I: v([0.15, 0.49, 0.08]) },
    { name: 'vastusLat', O: [v([0.16, 0.80, 0.0])], I: v([0.175, 0.50, 0.04]) },
    { name: 'vastusMed', O: [v([0.10, 0.66, 0.05])], I: v([0.135, 0.49, 0.06]) },
    { name: 'adductors', O: [v([0.035, 0.80, 0.03])], I: v([0.12, 0.60, 0.01]) },
    { name: 'hamstrings', O: [v([0.085, 0.78, -0.07])], I: v([0.15, 0.48, -0.03]) },
    { name: 'gastroc', O: [v([0.16, 0.44, -0.02])], I: v([0.17, 0.27, -0.03]) },
    { name: 'soleus', O: [v([0.17, 0.36, -0.02])], I: v([0.2, 0.14, -0.02]) },
    { name: 'tibialisAnt', O: [v([0.175, 0.40, 0.05])], I: v([0.205, 0.12, 0.06]) },
    { name: 'scm', O: [v([0.045, 1.52, -0.005])], I: v([0.012, 1.36, 0.075]) },
  ];
}

let _A = null;
// lane A's basis: base positions (dm, MakeHuman) -> metres feet at 0 (bake_body.py P0), joints, landmarks, muscle fields
export async function loadDrawAnatomy({ base = new URL('../../../../assets/body/', import.meta.url).href } = {}) {
  if (_A) return _A;
  const [bm, bb] = await Promise.all([fetch(base + 'basis.json').then(r => r.json()), fetch(base + 'basis.bin').then(r => r.arrayBuffer())]);
  return (_A = drawAnatomyFrom(bm, bb));
}
export function drawAnatomyFrom(bm, bb) {
  const n = bm.n, B = new Float32Array(bb, bm.base.o, n * 3); let g = Infinity;
  for (let v = 0; v < NB; v++) g = Math.min(g, B[v * 3 + 1]);
  const P0 = new Float32Array(n * 3); for (let v = 0; v < n; v++) { P0[v * 3] = B[v * 3] * 0.1; P0[v * 3 + 1] = (B[v * 3 + 1] - g) * 0.1; P0[v * 3 + 2] = B[v * 3 + 2] * 0.1; }
  const pv = i => new THREE.Vector3(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]);
  const J = name => { const b = bm.bones.find(x => x.name === name), ids = bm.joints[b.head], p = new THREE.Vector3(); for (const i of ids) p.add(pv(i)); return p.multiplyScalar(1 / ids.length); };
  const LM = name => pv(bm.landmarks[name]);
  const nearest = (p, side) => { let best = -1, bd = Infinity; for (let v = 0; v < NB; v++) { const x = P0[v * 3]; if (side * x < -0.004) continue; const d = (x - p.x) ** 2 + (P0[v * 3 + 1] - p.y) ** 2 + (P0[v * 3 + 2] - p.z) ** 2; if (d < bd) { bd = d; best = v; } } return best; };
  const mir = p => new THREE.Vector3(-p.x, p.y, p.z);
  const muscles = muscleTable(J, LM).map(m => ({ ...m, ids: { L: { O: m.O.map(p => nearest(p, 1)), I: nearest(m.I, 1) }, R: { O: m.O.map(p => nearest(mir(p), -1)), I: nearest(mir(m.I), -1) } } }));
  const fields = muscles.map(m => { const t = bm.fields[m.name]; if (!t) return null; const ix = new Uint16Array(bb, t.o, t.k), q = new Int16Array(bb, t.o + ((t.k * 2 + 3) & ~3), t.k), f = new Float32Array(t.k); for (let i = 0; i < t.k; i++) f[i] = q[i] * t.s; return { ix, f }; });
  return { n, muscles, fields, landmarks: bm.landmarks, source: 'assets/body/basis.{json,bin} muscle fields + scripts/bake_body.py lines of action (HUMAN c8 lane A, CC0)' };
}

// ---------------------------------------------------------------- chains (skin weights -> which axis a vertex belongs to)
const chainOf = name => { const s = name.endsWith('.L') ? 'L' : name.endsWith('.R') ? 'R' : '';
  if (/^(shoulder01|upperarm|lowerarm|wrist|finger|metacarpal)/.test(name)) return 'arm' + s;
  if (/^(upperleg|lowerleg)/.test(name)) return 'leg' + s;
  if (/^(foot|toe)/.test(name)) return 'foot' + s;
  return 'trunk'; };
const CHAINS = ['trunk', 'armL', 'armR', 'legL', 'legR', 'footL', 'footR'];
function chainFrames(h) {
  const I = h.idx, H0 = k => h.head0[I[k]].clone(), F = {};
  const spine = H0('spine03');
  F.trunk = { o: new THREE.Vector3(0, 0, spine.z), d: new THREE.Vector3(0, 1, 0), r: R_TRUNK, R: 0.14 };
  // every chain's axis points UP its limb (toward the trunk) and its phase starts at the height of its root joint, so where
  // the skin weights blend two chains the phases agree in sign and value at the joint: bands rotate, they never close into
  // contour-map loops (the first board: rings round the crotch and the sleeve caps)
  for (const s of ['L', 'R']) {
    F['arm' + s] = { o: H0('upperarm01.' + s), d: H0('upperarm01.' + s).sub(H0('wrist.' + s)).normalize(), r: R_LIMB, R: 0.045 };
    F['leg' + s] = { o: H0('upperleg01.' + s), d: H0('upperleg01.' + s).sub(H0('foot.' + s)).normalize(), r: R_LIMB, R: 0.065 };
    const toe = I['toe3-1.' + s] != null ? H0('toe3-1.' + s) : H0('foot.' + s).add(new THREE.Vector3(0, -0.05, 0.12));
    F['foot' + s] = { o: H0('foot.' + s), d: H0('foot.' + s).sub(toe).normalize(), r: R_FOOT, R: 0.04 };
  }
  for (const c of Object.values(F)) { const z = new THREE.Vector3(0, 0, 1); c.e1 = z.addScaledVector(c.d, -z.dot(c.d)); if (c.e1.lengthSq() < 1e-6) c.e1.set(0, 1, 0).addScaledVector(c.d, -c.d.y); c.e1.normalize(); c.e2 = new THREE.Vector3().crossVectors(c.d, c.e1); }
  return F;
}

// smooth a per-vertex scalar over the triangle graph (a few Jacobi steps)
function smoothField(f, index, n, it = 4) {
  const nb = new Float32Array(n), cnt = new Float32Array(n); let a = f;
  for (let k = 0; k < it; k++) { nb.fill(0); cnt.fill(0);
    for (let t = 0; t < index.length; t += 3) { const i = index[t], j = index[t + 1], l = index[t + 2]; nb[i] += a[j] + a[l]; nb[j] += a[i] + a[l]; nb[l] += a[i] + a[j]; cnt[i] += 2; cnt[j] += 2; cnt[l] += 2; }
    const b = new Float32Array(n); for (let v = 0; v < n; v++) b[v] = cnt[v] ? 0.5 * a[v] + 0.5 * nb[v] / cnt[v] : a[v]; a = b; }
  return a;
}

// the fields of one geometry (bind positions, skin weights) against the hero's chains; muscles only for the body
function geomFields(g, h, F, A, { body = false, face = 0 } = {}) {
  const P = g.attributes.position.array, n = g.attributes.position.count, SI = g.attributes.skinIndex?.array, SW = g.attributes.skinWeight?.array;
  const names = h.names, a0 = new Float32Array(n * 4), a1 = new Float32Array(n * 4), p = new THREE.Vector3(), q = new THREE.Vector3();
  const cid = names.map(chainOf);
  for (let v = 0; v < n; v++) {
    p.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    const m = {}; let tot = 0;
    if (SI && SW) for (let k = 0; k < 4; k++) { const w = SW[v * 4 + k]; if (w <= 0) continue; const c = cid[SI[v * 4 + k]] || 'trunk'; m[c] = (m[c] || 0) + w; tot += w; }
    if (!tot) { m.trunk = 1; tot = 1; }
    let u = 0, dom = 'trunk', dw = -1;
    for (const c of CHAINS) { const w = (m[c] || 0) / tot; if (!w) continue; const f = F[c]; q.copy(p).sub(f.o); const al = q.dot(f.d), r2 = q.lengthSq() - al * al; u += w * (al + f.o.y - BOWL * r2 / f.R); if (w > dw) { dw = w; dom = c; } }
    const f = F[dom]; q.copy(p).sub(f.o); const along = q.dot(f.d); q.addScaledVector(f.d, -along);
    const th = Math.atan2(q.dot(f.e2), q.dot(f.e1));
    a0[v * 4] = u; a0[v * 4 + 1] = th * f.r; a1[v * 4] = dw; a1[v * 4 + 1] = face; if (face) a1[v * 4 + 3] = -1;   // the eyes: w = -1
  }
  if (body) bodyExtras(g, h, A, a0, a1);
  g.setAttribute('aDr0', new THREE.BufferAttribute(a0, 4)); g.setAttribute('aDr1', new THREE.BufferAttribute(a1, 4));
  g.userData.drawFields = true;
  return { a0, a1 };
}

// body only: region weights (face, hands, feet) and the muscle fibre phases
function bodyExtras(g, h, A, a0, a1) {
  const n = g.attributes.position.count, P = g.attributes.position.array, N = g.attributes.normal.array, index = g.index ? g.index.array : null, AH = h.aHero;
  const R = { head: 0, hand: 5, finger: 6, foot: 10, jaw: 11 };
  const ind = test => { const f = new Float32Array(n); for (let v = 0; v < Math.min(n, AH.length / 4); v++) f[v] = test(Math.round(AH[v * 4])) ? 1 : 0; return index ? smoothField(f, index, n, 5) : f; };
  const fw = ind(r => r === R.head || r === R.jaw), hw = ind(r => r === R.hand || r === R.finger), tw = ind(r => r === R.foot);
  for (let v = 0; v < n; v++) { a1[v * 4 + 1] = fw[v]; a1[v * 4 + 2] = hw[v]; a1[v * 4 + 3] = tw[v]; }
  if (!A) return;
  // dominant muscle per vertex (side by the bind x), its strength and the margin over the next
  const nm = A.muscles.length, f1 = new Float32Array(n), f2 = new Float32Array(n), dom = new Int16Array(n).fill(-1);
  A.fields.forEach((F, m) => { if (!F) return; for (let k = 0; k < F.ix.length; k++) { const v = F.ix[k]; if (v >= n) continue; const x = F.f[k];
    if (x > f1[v]) { f2[v] = f1[v]; f1[v] = x; dom[v] = m; } else if (x > f2[v]) f2[v] = x; } });
  // per muscle and side: origin, insertion, mean normal, the plane family
  const pv = i => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const fam = A.muscles.map((M, m) => { const out = {}; for (const s of ['L', 'R']) { const id = M.ids[s], O = new THREE.Vector3(); id.O.forEach(i => O.add(pv(i))); O.multiplyScalar(1 / id.O.length); const I = pv(id.I);
      const nb = new THREE.Vector3(), F = A.fields[m]; if (F) for (let k = 0; k < F.ix.length; k++) { const v = F.ix[k]; if (v >= n || F.f[k] < 0.3 || (s === 'L') !== (P[v * 3] >= 0)) continue; nb.x += N[v * 3] * F.f[k]; nb.y += N[v * 3 + 1] * F.f[k]; nb.z += N[v * 3 + 2] * F.f[k]; }
      nb.normalize(); const a = I.clone().sub(O).normalize(), b = new THREE.Vector3().crossVectors(a, nb).normalize();
      const e1 = O.clone().sub(I); e1.addScaledVector(nb, -e1.dot(nb)); const r = e1.length(); e1.normalize(); const e2 = new THREE.Vector3().crossVectors(nb, e1);
      out[s] = { O, I, a, b, nb, e1, e2, r }; } return out; });
  const w = new Float32Array(n), psi = new Float32Array(n), q = new THREE.Vector3();
  for (let v = 0; v < n; v++) { const m = dom[v]; if (m < 0) continue; const s = P[v * 3] >= 0 ? 'L' : 'R', Fm = fam[m][s], M = A.muscles[m]; q.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    if (M.fan) { q.sub(Fm.I); psi[v] = Math.atan2(q.dot(Fm.e2), q.dot(Fm.e1)) * Fm.r; } else psi[v] = q.sub(Fm.O).dot(Fm.b);
    w[v] = sstep(0.1, 0.4, f1[v]) * sstep(0.0, 0.1, f1[v] - f2[v]); }
  // a triangle across a border (two muscles, or the midline) interpolates two phases: all its vertices drop to 0
  if (index) for (let t = 0; t < index.length; t += 3) { const i = index[t], j = index[t + 1], l = index[t + 2];
    const side = x => P[x * 3] >= 0; if (dom[i] !== dom[j] || dom[j] !== dom[l] || side(i) !== side(j) || side(j) !== side(l)) { w[i] = 0; w[j] = 0; w[l] = 0; } }
  for (let v = 0; v < n; v++) { a0[v * 4 + 2] = psi[v]; a0[v * 4 + 3] = w[v]; }
  g.userData.drawMuscle = { dom, n: nm };
}

// all of a hero's geometries; idempotent per geometry (a styled person shares nothing between heroes)
export function drawFields(h, A = _A) {
  const F = chainFrames(h); let k = 0;
  h.group.traverse(m => { if (!m.isMesh || !m.geometry?.attributes?.position || m.geometry.userData.drawFields) return;
    const body = m === h.body, face = m === h.eyes ? 1 : 0; geomFields(m.geometry, h, F, A, { body, face }); k++; });
  h._drawFields = { frames: F, meshes: k, muscles: A ? A.muscles.length : 0 };
  return h._drawFields;
}
