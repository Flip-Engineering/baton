// BODY / GIRDLE 7 (HUMAN c8 round 7, BODY7 iteration 2, 8 Oct 2026): the shoulder girdle follows the arm. Opt-in (rev 7.3): nothing imports this
// file unless it asks; a hero that never calls girdle7() poses exactly as before.
//
// WHAT IS WRONG (measured, node, 8 Oct; review/studio_human_c8/after/body7/NOTES.md iteration 2): on the twelve v6 bodies the acromion sits
// +0.014 to +0.018 of stature above the sternal notch (ANSUR II, BMI 19.5-27, per subject: men +0.0006, IQR -0.005..+0.007; women +0.0036, IQR
// -0.002..+0.009) and only 0.020-0.025 of stature below C7 (ANSUR: men 0.0445, p10 0.034; women 0.0377, p10 0.028): every man at or above ANSUR's
// p90 acromial height, the acromion-to-axilla height 0.087 of stature (ANSUR men 0.060), the shoulder a high flat shelf (the photographs' c2 men
// are 0.133 of stature wide at 0.84 of stature, ours 0.226). Part of it is the A-pose bind (the humerus 34-41 deg from hanging; the clavicle rises
// a little past 30 deg of elevation), most of it the frame itself (the learned surface on hm08's skeleton); every stance we have (workforce
// restArm / idleStanceKin, motion/stance.js) lowers the arm by an IK on upperarm01 and never moves the clavicle, so the standing figure keeps it.
// THE CHANGE: after any stance, each clavicle is depressed about its own head (the sternoclavicular joint) by the angle that brings the acromion
// down to ANSUR's place for this person (girdleOf7, read once on the bind body: the mean of the notch and the C7 reads, 0..0.025 of stature), in
// full while the arm hangs and fading out as the arm rises (G7 below: a raised arm, a wave or a reach, keeps the bind's girdle); the upper arm is
// turned back by the same angle so the arm keeps the direction the stance gave it and only moves down with its shoulder. Bones, skin weights and
// the IK are untouched: the skin over the acromion (weights upperarm01 0.61, shoulder01 0.27, clavicle 0.08) comes down by the full drop, the
// upper trapezius (neck01 0.32, clavicle 0.26, ...) by about two thirds of it (the neck-to-shoulder slope), the axillary folds (spine 0.8) hardly.
//
//   import { girdleOf7, girdle7 } from '../body/girdle7.js';
//   const g = girdleOf7(S, built, sex);       // node or page, on the BIND body (lib/fx/body build()); a rev 7.3 record stores it: rec.prior.prior.rev7.girdle
//   ... stand the hero (any stance or clip frame) ...;  girdle7(h, g);   // after the pose, every frame the pose changes (it reads the arm's elevation)
//   (girdle7 always clears the hands (handsClear7, rev 7.4) and relaxes the skin over the girdle with the neck held (girdleRelax7 GR7 v2, rev 7.6);
//   c3, 8 Oct: the switches back to rev 7.3 / 7.4 / 7.5 (clear: false, relax: false, relax: { neck: false }) are DELETED: superseded; git has them)
import * as THREE from 'three';
import { nippleAt } from './nipple.js';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const GIRDLE7_VERSION = 1;   // the calibration (girdleOf7); the pose steps: rev 7.3 girdle, 7.4 handsClear7 (HC7), 7.5 girdleRelax7 (GR7)
// ANSUR II (all subjects with BMI 19.5-27, per-subject differences over stature; ~/.cache/acp_human/data ANSUR_II_*_Public.csv, read 8 Oct 06:57)
export const ANSUR_G7 = { m: { notch: 0.0006, c7: 0.0445, n: 1804 }, f: { notch: 0.0036, c7: 0.0377, n: 1311 } };
// the rhythm: the full depression while the humerus is within `rest` of hanging against the thorax (0.5 rad, ~30 deg: the 'setting phase', Inman
// 1944: the scapula hardly moves in the first 30 deg of elevation; a relaxed stand is 0.15-0.45 against the thorax axis, which leans forward in a
// stance), none from `top` (1.3 rad, ~75 deg: a raised arm keeps the bind's girdle), smoothstep between, so a clip moving the arm moves the
// shoulder smoothly. NOTE: the bind's humerus is only 0.60-0.72 rad from hanging (34-41 deg), so the A-pose explains ~1 cm of the raised girdle at
// most (the rhythm); the rest is the frame itself (the learned surface and hm08's skeleton): the drop is calibrated to ANSUR's standing heights
// whatever its cause. max: the largest drop (fraction of stature)
export const G7 = { rest: 0.5, top: 1.3, max: 0.025 };
const r4 = x => +x.toFixed(4), sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };

// the calibration on a built bind body B (lib/fx/body build(): pos, heads, stature; y up) of studio S, per side: the acromion's height over the
// sternal notch and under C7 (fractions of stature), the drop that brings it to ANSUR's (the mean of the two reads, 0..G7.max), the clavicle
// angle (rad, in the frontal plane about the sternoclavicular joint) that gives that drop, and the bind's humerus angle from hanging
export function girdleOf7(S, B, sex) {
  const P = B.pos, H = B.stature, L = S.landmarks, bones = S.hero.meta.bones, J = nm => B.heads[bones.findIndex(b => b.name === nm)];
  const y = i => P[i * 3 + 1], x = i => P[i * 3], A = ANSUR_G7[sex === 'f' ? 'f' : 'm'], sn = y(L.suprasternale), c7 = y(L.cervicale);
  const out = { version: GIRDLE7_VERSION, sex, side: {} };
  // the thorax axis, the same definition girdle7() reads on the posed hero: root to neck01, orthogonal to the shoulder line (not the world's
  // vertical: the trunk leans forward a little in any stance, and the rhythm is the arm against the thorax)
  const lat = norm(sub(J('upperarm01.L'), J('upperarm01.R'))), up0 = sub(J('neck01'), J('root')), up = norm(up0.map((v, i) => v - dot(up0, lat) * lat[i]));
  for (const s of ['L', 'R']) {
    const ai = L['acromion' + s], sc = J('clavicle.' + s), gh = J('upperarm01.' + s), el = J('lowerarm01.' + s);
    const notch = (y(ai) - sn) / H, cerv = (c7 - y(ai)) / H, dN = notch - A.notch, dC = A.c7 - cerv, drop = clamp((dN + dC) / 2, 0, G7.max);
    const cx = Math.abs(x(ai) - sc[0]), cy = y(ai) - sc[1], r = Math.hypot(cx, cy), phi0 = Math.atan2(cy, cx), phi1 = Math.asin(clamp((cy - drop * H) / r, -1, 1));
    const u = norm(sub(el, gh)), elev = Math.acos(clamp(-dot(u, up), -1, 1));
    out.side[s] = { notch: r4(notch), cerv: r4(cerv), dN: r4(dN), dC: r4(dC), drop: r4(drop), theta: r4(Math.max(0, phi0 - phi1)), elev: r4(elev) };
  }
  return out;
}

// apply to a posed hero h (lib/fx/hero.js Hero: bone(), joint(), rotateWorld(), update()). k scales the calibrated angle (1 = ANSUR's place).
// Returns { L: { ang, f, dropMm }, R: ... } (ang the applied clavicle angle in rad, f the rhythm factor, dropMm the shoulder joint's measured drop).
export function girdle7(h, g, { k = 1, rest = G7.rest, top = G7.top, clearOpts = {}, relaxOpts = {}, slideOpts = {}, axOpts = {} } = {}) {
  if (!g?.side || !h?.bone?.('clavicle.L')) return null;
  // rev 7.5 (BODY7 c2 iteration 1): the skin over the girdle is relaxed after the pose (girdleRelax7 below); a previous call's correction comes
  // off first (the bind as built), and the stance's skin matrices are kept as the reference.
  girdleReset7(h); const BM0 = skinMatrices7(h), GH0 = { L: h.joint('upperarm01.L'), R: h.joint('upperarm01.R') };
  const jL = h.joint('upperarm01.L'), jR = h.joint('upperarm01.R'), lat = jL.clone().sub(jR).normalize();
  const up = h.joint('neck01').sub(h.joint('root')); up.addScaledVector(lat, -up.dot(lat)).normalize();
  const axis = lat.clone().cross(up).normalize(), out = {};
  for (const s of ['L', 'R']) {
    const G = g.side[s]; if (!G || !G.theta) { out[s] = { ang: 0, f: 0, dropMm: 0 }; continue; }
    const S0 = h.joint('upperarm01.' + s), dir = h.joint('lowerarm01.' + s).sub(S0).normalize(), elev = Math.acos(clamp(-dir.dot(up), -1, 1));
    const t = clamp((elev - rest) / (top - rest), 0, 1), f = 1 - t * t * (3 - 2 * t); let ang = k * f * G.theta;
    if (!ang) { out[s] = { ang: 0, f: +f.toFixed(3), elev: r4(elev), dropMm: 0 }; continue; }
    const y0 = S0.dot(up); h.rotateWorld('clavicle.' + s, axis, ang);
    if (h.joint('upperarm01.' + s).dot(up) > y0) { h.rotateWorld('clavicle.' + s, axis, -2 * ang); ang = -ang; }      // the axis' sign: depress, never elevate
    h.rotateWorld('upperarm01.' + s, axis, -ang);                                                                         // the arm keeps the stance's direction
    out[s] = { ang: r4(Math.abs(ang)), f: +f.toFixed(3), elev: r4(elev), dropMm: +((y0 - h.joint('upperarm01.' + s).dot(up)) * 1000).toFixed(1) };
  }
  h.update?.();
  // rev 7.4 (BODY7 iteration 3): the lowered hands rest outside the hip and thigh (handsClear7 below)
  out.clear = handsClear7(h, clearOpts);
  if (out.L?.ang || out.R?.ang || out.clear?.L?.rad || out.clear?.R?.rad) out.relax = girdleRelax7(h, BM0, GH0, relaxOpts);
  // c4 (15 Oct): the skin of the neck base, the shoulder and the axilla slides as a membrane over the posed tissue (skinSlide7 below)
  if (slideOpts !== false) out.slide = skinSlide7(h, slideOpts || {});
  // c4 it2 (15 Oct): the skin where the arm meets the trunk cannot fold through itself (axillaUntangle7 below)
  if (axOpts !== false) out.axilla = axillaUntangle7(h, axOpts || {});
  return out;
}

// ---------------------------------------------------------------- rev 7.4 (BODY7 iteration 3, 8 Oct): the hands clear the hip and the thigh
// MEASURED (measurer it2: review/studio_human_c8/after/body7/measures/it2.md, tools/hand_inside_m2.py, a parity test on the posed mesh in
// lab_body7's 'stand' = workforce idleStance): v6 already has 3-13 % of the hand's vertices inside the thigh / pelvis volume (16-38 mm deep);
// 7.3 has 11-25 % (up to 54 mm): the girdle carries the hand 1.6-3.0 cm down onto the trochanter's width and rev 7's hands are 7-15 mm longer.
// A relaxed standing arm falls from the shoulder until the hand meets the side of the hip and hangs just outside it (the forearm and the
// hand are pushed out by the greater trochanter: the arm is a few degrees abducted in every photograph of a quiet stand). So, after the
// girdle, each arm is abducted at the glenohumeral joint (about the pelvis' forward axis) by the smallest angle that puts every hand vertex
// outside the hip and the thigh by HC7.margin. The test reads the POSED MESH itself (three's CPU skinning: the positions the exporter and
// Cycles get): the side's pelvis and thigh triangles in the hand's height band are rasterised on a side-view grid (height x depth, HC7.cell)
// as the outermost and innermost lateral surface; a hand vertex between the two in its cell is inside, and its depth is the outer surface's
// lateral distance minus its own. Nothing else moves (the elbow, the forearm's roll, the wrist and the fingers keep the stance's shape); a
// hand already clear is left exactly where the stance put it. Cost: ~5-8k vertices skinned on the CPU per side once, the hand's up to
// HC7.handMax per iteration (node: tens of ms a figure); for a clip, call per frame (it is continuous in the pose) or pass clear: false.
export const HC7 = { version: 1, margin: 0.005, cell: 0.005, maxRad: 0.21, iters: 4, handMax: 2500 };
const REG7 = { hand: 5, finger: 6, pelvis: 7, thigh: 8 };            // hero.js HERO_REGIONS (aHero.x); aHero.z: +1 where the bind x > 0
const _hc = new WeakMap(), _pv = new THREE.Vector3();
function hcIndex(g) {
  let C = _hc.get(g); if (C) return C;
  const A = g.attributes.aHero; if (!A) return null;
  const n = A.count, reg = new Uint8Array(n), pos = new Uint8Array(n);
  for (let v = 0; v < n; v++) { reg[v] = Math.round(A.getX(v)); pos[v] = A.getZ(v) > 0 ? 1 : 0; }
  const hand = [[], []], tri = [[], []], legV = [[], []], seen = [new Uint8Array(n), new Uint8Array(n)], leg = r => r === REG7.pelvis || r === REG7.thigh;
  for (let v = 0; v < n; v++) if (reg[v] === REG7.hand || reg[v] === REG7.finger) hand[pos[v]].push(v);
  const I = g.index ? g.index.array : null, nt = I ? I.length / 3 : n / 3;
  for (let t = 0; t < nt; t++) {
    const a = I ? I[3 * t] : 3 * t, b = I ? I[3 * t + 1] : 3 * t + 1, c = I ? I[3 * t + 2] : 3 * t + 2;
    if (!leg(reg[a]) || !leg(reg[b]) || !leg(reg[c]) || pos[a] !== pos[b] || pos[a] !== pos[c]) continue;
    const s = pos[a]; tri[s].push(a, b, c); for (const v of [a, b, c]) if (!seen[s][v]) { seen[s][v] = 1; legV[s].push(v); }
  }
  const slot = new Int32Array(n).fill(-1); for (const s of [0, 1]) legV[s].forEach((v, i) => { slot[v] = i; });
  C = { side: [0, 1].map(s => { const H = hand[s], k = Math.max(1, Math.ceil(H.length / HC7.handMax));
    return { hand: Int32Array.from(H.filter((_, i) => i % k === 0)), nHand: H.length, tri: Uint32Array.from(tri[s]), legV: Int32Array.from(legV[s]) }; }), slot };
  _hc.set(g, C); return C;
}
// the posed vertices idx of the hero's body in the pelvis frame (o origin; out = sg x lateral, y up, z forward) -> Float32Array [out, y, z] * n
function posed7(m, idx, o, lat, up, fwd, sg) {
  const R = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) { m.getVertexPosition(idx[i], _pv); _pv.applyMatrix4(m.matrixWorld).sub(o);
    R[3 * i] = sg * _pv.dot(lat); R[3 * i + 1] = _pv.dot(up); R[3 * i + 2] = _pv.dot(fwd); }
  return R;
}
// h: a posed Hero (after the stance and the girdle). Returns { L: { rad, nIn0, nIn1, depth0Mm, depth1Mm }, R: ..., ms } or null (no regions)
export function handsClear7(h, { margin = HC7.margin, cell = HC7.cell, maxRad = HC7.maxRad, iters = HC7.iters } = {}) {
  const m = h?.body, C = m?.geometry && hcIndex(m.geometry); if (!C || !h.bone?.('upperarm01.L')) return null;
  const t0 = Date.now(); h.update?.(); m.updateMatrixWorld(true);
  const hL = h.joint('upperleg01.L'), hR = h.joint('upperleg01.R'), o = h.joint('root'), lat = hL.clone().sub(hR).normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(lat, -lat.y).normalize(), fwd = lat.clone().cross(up).normalize(), out = {};
  // which aHero side is the hero's L: the hand group nearer the left wrist (hm08: bind +x)
  const wL = h.joint('wrist.L'); let sL = 1;
  { const H1 = C.side[1].hand; if (H1.length) { m.getVertexPosition(H1[0], _pv); _pv.applyMatrix4(m.matrixWorld); if (_pv.distanceTo(wL) > _pv.distanceTo(h.joint('wrist.R'))) sL = 0; } }
  for (const s of ['L', 'R']) {
    const D = C.side[s === 'L' ? sL : 1 - sL], sg = s === 'L' ? 1 : -1, bone = 'upperarm01.' + s;
    if (!D.hand.length || !D.tri.length) { out[s] = null; continue; }
    let Hc = posed7(m, D.hand, o, lat, up, fwd, sg); let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < D.hand.length; i++) { y0 = Math.min(y0, Hc[3 * i + 1]); y1 = Math.max(y1, Hc[3 * i + 1]); }
    y0 -= 0.03; y1 += 0.04;
    // the hip's lateral surfaces on a side-view grid in the hand's band
    const Lc = posed7(m, D.legV, o, lat, up, fwd, sg), T = D.tri, slot = C.slot; let z0 = Infinity, z1 = -Infinity, any = false;
    for (let i = 0; i < D.legV.length; i++) { const y = Lc[3 * i + 1]; if (y < y0 || y > y1) continue; any = true; z0 = Math.min(z0, Lc[3 * i + 2]); z1 = Math.max(z1, Lc[3 * i + 2]); }
    if (!any) { out[s] = { rad: 0, nIn0: 0, nIn1: 0, depth0Mm: 0, depth1Mm: 0, band: 'none' }; continue; }
    z0 -= cell; z1 += cell; const ny = Math.ceil((y1 - y0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
    const oMax = new Float32Array(ny * nz).fill(-Infinity), oMin = new Float32Array(ny * nz).fill(Infinity), e = 0.02;
    for (let t = 0; t < T.length; t += 3) {
      const a = 3 * slot[T[t]], b = 3 * slot[T[t + 1]], c = 3 * slot[T[t + 2]];
      const ya = Lc[a + 1], yb = Lc[b + 1], yc = Lc[c + 1]; if (Math.max(ya, yb, yc) < y0 || Math.min(ya, yb, yc) > y1) continue;
      const za = Lc[a + 2], zb = Lc[b + 2], zc = Lc[c + 2], den = (yb - ya) * (zc - za) - (yc - ya) * (zb - za); if (Math.abs(den) < 1e-12) continue;
      const iy0 = Math.max(0, Math.floor((Math.min(ya, yb, yc) - y0) / cell - 0.5)), iy1 = Math.min(ny - 1, Math.ceil((Math.max(ya, yb, yc) - y0) / cell - 0.5));
      const iz0 = Math.max(0, Math.floor((Math.min(za, zb, zc) - z0) / cell - 0.5)), iz1 = Math.min(nz - 1, Math.ceil((Math.max(za, zb, zc) - z0) / cell - 0.5));
      for (let iy = iy0; iy <= iy1; iy++) { const py = y0 + (iy + 0.5) * cell;
        for (let iz = iz0; iz <= iz1; iz++) { const pz = z0 + (iz + 0.5) * cell;
          const l1 = ((py - ya) * (zc - za) - (yc - ya) * (pz - za)) / den, l2 = ((yb - ya) * (pz - za) - (py - ya) * (zb - za)) / den, l0 = 1 - l1 - l2;
          if (l0 < -e || l1 < -e || l2 < -e) continue;
          const v = l0 * Lc[a] + l1 * Lc[b] + l2 * Lc[c], k = iy * nz + iz; if (v > oMax[k]) oMax[k] = v; if (v < oMin[k]) oMin[k] = v; } }
    }
    const depth = Q => { let worst = -Infinity, wi = -1, nIn = 0, deep = 0;
      for (let i = 0; i < D.hand.length; i++) { const iy = Math.floor((Q[3 * i + 1] - y0) / cell), iz = Math.floor((Q[3 * i + 2] - z0) / cell); if (iy < 0 || iy >= ny || iz < 0 || iz >= nz) continue;
        const k = iy * nz + iz, mx = oMax[k]; if (mx === -Infinity) continue; const q = Q[3 * i]; if (q < oMin[k] - 0.01) continue;
        if (q < mx) { nIn++; deep = Math.max(deep, mx - q); } const need = mx + margin - q; if (need > worst) { worst = need; wi = i; } }
      return { worst, wi, nIn, deep }; };
    const d0 = depth(Hc); let d = d0, rad = 0;
    for (let it = 0; it < iters && d.worst > 0 && rad < maxRad; it++) {
      const S = h.joint(bone); m.getVertexPosition(D.hand[d.wi], _pv); _pv.applyMatrix4(m.matrixWorld);
      const r = _pv.clone().sub(S), rr = r.clone().addScaledVector(fwd, -r.dot(fwd)).length() || 0.5;
      const ax = fwd.clone().multiplyScalar(Math.sign(fwd.clone().cross(r).dot(lat) * sg) || 1);    // the sense that moves the hand outward
      const ang = Math.min(Math.asin(clamp(d.worst / rr, 0, 1)) + 0.002, maxRad - rad);
      h.rotateWorld(bone, ax, ang); h.update?.(); m.updateMatrixWorld(true); rad += ang;
      Hc = posed7(m, D.hand, o, lat, up, fwd, sg); d = depth(Hc);
    }
    out[s] = { rad: r4(rad), deg: +(rad * 180 / Math.PI).toFixed(2), nIn0: d0.nIn, nIn1: d.nIn, depth0Mm: +(d0.deep * 1000).toFixed(1), depth1Mm: +(d.deep * 1000).toFixed(1), n: D.hand.length };
  }
  out.ms = Date.now() - t0; out.version = HC7.version;
  return out;
}

// ---------------------------------------------------------------- rev 7.5 (BODY7 c2 iteration 1, 8 Oct): the skin over the girdle, relaxed
// MEASURED (the orchestrator's 09:02 read of the Cycles clay job 1008-083607; the checker's F1, review/.../body7/CHECK.md; node, fold_probe):
// on every rev 7.4 figure a hard ridge with a sharp shadow edge runs from the acromion down and in across the deltopectoral junction (front
// shoulder dihedral max 88-177 deg against 52-111 without the girdle; L21: 112 / 113 edges in the shoulder band shortened below 0.75 of their
// length, 37 / 42 triangles turned over), and smaller at the posterior axillary fold. CAUSE: linear blend skinning. The girdle moves the arm
// and the deltoid DOWN 17-32 mm as a block (the clavicle's depression, the arm turned back by the same angle) while the chest wall stays
// (spine01 / spine02); at the anterior and posterior axillary folds the skin weights go from the trunk's bones to the arm's (upperarm01 /
// upperarm02) over 1-2 cm, so a 3 cm displacement step is packed into 1-2 cm of skin: the deltoid's border folds over the pectoral. A real
// shoulder does not do that: when the girdle is depressed the pectoralis major (clavicle and humerus to the sternum), the latissimus and the
// skin of the axilla spread the movement over the whole muscle, from its insertion on the arm to its origin on the trunk.
// THE CHANGE: after the girdle and the hand clearance, the displacement the girdle gave each vertex (posed now minus posed in the stance
// alone) is replaced, in a band around each arm's junction with the trunk, by the smoothest field with the same values on the band's
// edges (harmonic: each vertex the mean of its neighbours; Gauss-Seidel with over-relaxation), so the step spreads over the pectoral, the
// axilla and the back. The band: from the border of the arm's rigid part (skin weight on the clavicle and everything below it >= aHi) out
// over the trunk side rb of stature along the surface (geodesic), and into the arm side rbArm of stature but only below the shoulder joint
// and medial of it (the axilla, its folds and the inner arm: the deltoid's cap and outer face, the acromion and the top of the shoulder keep
// exactly the girdle's drop, so the shoulder line of rev 7.3 / 7.4 stands); not the head and jaw, not the hands; keepR > 0 also holds a disc round each nipple-areola (nippleAt) still
// (default 0: a held disc 2-4 cm across sits 3-5 cm from the men's anterior axillary fold and steepens the field between them: L11 shortened
// edges 3 / 7 -> 17 / 19 with keepR 0.025; with keepR 0 the men's nipple is not moved at all and the women's moves 3-4 mm, stats.nippleShiftMm).
// The result is written back into the body geometry's BIND positions (through each vertex's blended
// skin matrix: posed = M b, so b' = M^-1 posed) and its normals are rebuilt from the posed surface, so the GPU, three's CPU skinning, the
// exporters and Cycles all get it, with no new attribute and no shader change (the v5 body's 16 attributes are all in use).
// SIDE EFFECT (measured, said plainly): a paint the skin shader evaluates in BIND space (vBind = position: lab underwear, likeness zones) is
// evaluated at the moved bind position, so inside the band it slides on the skin by the correction (mean 3-6 mm, at most 10-19 mm, at the
// anterior and posterior axillary folds; at the nipple-areola 0-6 mm: stats.nippleShiftMm). SKIN7's areola is the one such paint with a
// place of its own: its centre uniforms (h.likeness.skin.U.likeAreo0 / 1, bind space) are moved with the skin here (stats.areolaMm) and put
// back by girdleReset7, so the painted areola and the nipple's relief stay together. UV-mapped textures (skin maps, DETAIL7's fine tier) follow the
// skin exactly. Restored by girdleReset7(h) (and at the start of every girdle7 call), so a pose without the girdle draws the bind as built.
// Cost: ~10 k vertices skinned twice, a 6-10 k vertex band, 150-300 sweeps: 0.2-0.8 s a figure in node on a loaded box (stills; for a clip
// call girdle7 only on the frames that are kept).
// GR7 v2 (BODY7 c2 iteration 2, 8 Oct): the NECK is not part of the band. Measurer c2 it1: v1's band reached up the trapezius into the neck
// (hm08 region 1: 831 of its vertices moved on L21), and with the head and jaw held the harmonic field pulled the neck base down 4-5 mm on
// average (up to 12-14.5 mm at the nape; the 7.4 girdle moved it ~1 mm): the top contour 0.06 H from the midline 9-16 mm under 7.4's and the
// trapezius slope 27.8 -> 21.9 deg (photographs c2 p10 27.8). It holds region 1 and everything above neckH of stature (posed, the
// stance alone) at the girdle's own displacement (Dirichlet), so the field spreads the step over the pectoral, the axilla and the back only.
// The hold above the neck base is SOFT (a screened field: each vertex is also drawn to the girdle's own displacement with a weight lam that rises
// from 0 at neckLo to neckLam at neckH of stature, smoothstep), so no hard edge is cut across the trapezius; region 1 is held hard.
export const GR7 = { version: 2, aHi: 0.95, rb: 0.15, rbArm: 0.06, keepR: 0, omega: 1.85, tol: 2e-6, maxIt: 800, neckLo: 0.82, neckH: 0.90, neckLam: 2 };
const _gr = new WeakMap();
function grIndex(g) {
  let C = _gr.get(g); if (C) return C;
  const I = g.index.array, n = g.attributes.position.count, nt = I.length / 3, deg = new Int32Array(n + 1), seen = new Set(), E = [];
  for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) { const key = a < b ? a * n + b : b * n + a; if (seen.has(key)) continue; seen.add(key); E.push(a, b); deg[a + 1]++; deg[b + 1]++; }
  for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
  const nb = new Int32Array(deg[n]), f = deg.slice(0, n); for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1]; nb[f[a]++] = b; nb[f[b]++] = a; }
  const tdeg = new Int32Array(n + 1); for (let i = 0; i < I.length; i++) tdeg[I[i] + 1]++; for (let v = 0; v < n; v++) tdeg[v + 1] += tdeg[v];
  const vt = new Int32Array(tdeg[n]), tf = tdeg.slice(0, n); for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) vt[tf[I[3 * t + j]]++] = t;
  C = { off: deg, nb, toff: tdeg, vt, saved: null }; _gr.set(g, C); return C;
}
// the skin matrices (bone world matrix x bone inverse) of a hero's body as they are now
function skinMatrices7(h) { const m = h.body; h.update?.(); m.updateMatrixWorld(true); m.skeleton.update(); return Float32Array.from(m.skeleton.boneMatrices); }
// posed (world) position of bind vertex v under skin matrices BM; M (Float64Array 12, the blended affine's 3x4) is filled when given
function skin7(X, SI, SW, BM, v, out, o, M) {
  const x = X[3 * v], y = X[3 * v + 1], z = X[3 * v + 2]; let m0 = 0, m1 = 0, m2 = 0, m4 = 0, m5 = 0, m6 = 0, m8 = 0, m9 = 0, m10 = 0, m12 = 0, m13 = 0, m14 = 0;
  for (let k = 0; k < 4; k++) { const w = SW[4 * v + k]; if (!w) continue; const b = SI[4 * v + k] * 16;
    m0 += w * BM[b]; m1 += w * BM[b + 1]; m2 += w * BM[b + 2]; m4 += w * BM[b + 4]; m5 += w * BM[b + 5]; m6 += w * BM[b + 6]; m8 += w * BM[b + 8]; m9 += w * BM[b + 9]; m10 += w * BM[b + 10]; m12 += w * BM[b + 12]; m13 += w * BM[b + 13]; m14 += w * BM[b + 14]; }
  out[o] = m0 * x + m4 * y + m8 * z + m12; out[o + 1] = m1 * x + m5 * y + m9 * z + m13; out[o + 2] = m2 * x + m6 * y + m10 * z + m14;
  if (M) { M[0] = m0; M[1] = m1; M[2] = m2; M[3] = m4; M[4] = m5; M[5] = m6; M[6] = m8; M[7] = m9; M[8] = m10; M[9] = m12; M[10] = m13; M[11] = m14; }
}
// dual-quaternion skinning of bind vertex v (Kavan et al. 2007): the blend of rigid motions, not of matrices, so a skin shared by two
// bones turned far apart keeps its volume instead of collapsing onto the chord (LBS' candy wrapper). BM may carry a uniform scale (the
// group's); it is taken out per bone and blended linearly.
function dqs7(X, SI, SW, BM, v, out, o) {
  let a0 = 0, a1 = 0, a2 = 0, a3 = 0, d0 = 0, d1 = 0, d2 = 0, d3 = 0, ss = 0, ref = null;
  for (let k = 0; k < 4; k++) { const w = SW[4 * v + k]; if (!w) continue; const b = SI[4 * v + k] * 16;
    const sc = Math.cbrt(Math.abs(BM[b] * (BM[b + 5] * BM[b + 10] - BM[b + 9] * BM[b + 6]) - BM[b + 4] * (BM[b + 1] * BM[b + 10] - BM[b + 9] * BM[b + 2]) + BM[b + 8] * (BM[b + 1] * BM[b + 6] - BM[b + 5] * BM[b + 2]))) || 1;
    const m00 = BM[b] / sc, m10 = BM[b + 1] / sc, m20 = BM[b + 2] / sc, m01 = BM[b + 4] / sc, m11 = BM[b + 5] / sc, m21 = BM[b + 6] / sc, m02 = BM[b + 8] / sc, m12 = BM[b + 9] / sc, m22 = BM[b + 10] / sc;
    let qw, qx, qy, qz; const tr = m00 + m11 + m22;
    if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; qw = 0.25 * S; qx = (m21 - m12) / S; qy = (m02 - m20) / S; qz = (m10 - m01) / S; }
    else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (m21 - m12) / S; qx = 0.25 * S; qy = (m01 + m10) / S; qz = (m02 + m20) / S; }
    else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (m02 - m20) / S; qx = (m01 + m10) / S; qy = 0.25 * S; qz = (m12 + m21) / S; }
    else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (m10 - m01) / S; qx = (m02 + m20) / S; qy = (m12 + m21) / S; qz = 0.25 * S; }
    if (!ref) ref = [qw, qx, qy, qz]; else if (qw * ref[0] + qx * ref[1] + qy * ref[2] + qz * ref[3] < 0) { qw = -qw; qx = -qx; qy = -qy; qz = -qz; }
    const tx = BM[b + 12], ty = BM[b + 13], tz = BM[b + 14];
    // dual part 0.5 * (0, t) * q
    const ew = -0.5 * (tx * qx + ty * qy + tz * qz), ex = 0.5 * (tx * qw + ty * qz - tz * qy), ey = 0.5 * (-tx * qz + ty * qw + tz * qx), ez = 0.5 * (tx * qy - ty * qx + tz * qw);
    a0 += w * qw; a1 += w * qx; a2 += w * qy; a3 += w * qz; d0 += w * ew; d1 += w * ex; d2 += w * ey; d3 += w * ez; ss += w * sc; }
  const l = Math.hypot(a0, a1, a2, a3) || 1; a0 /= l; a1 /= l; a2 /= l; a3 /= l; d0 /= l; d1 /= l; d2 /= l; d3 /= l;
  // translation = 2 * (d * conj(a)).xyz
  const tx = 2 * (-d0 * a1 + d1 * a0 - d2 * a3 + d3 * a2), ty = 2 * (-d0 * a2 + d1 * a3 + d2 * a0 - d3 * a1), tz = 2 * (-d0 * a3 - d1 * a2 + d2 * a1 + d3 * a0);
  const x = ss * X[3 * v], y = ss * X[3 * v + 1], z = ss * X[3 * v + 2];
  // rotate (x, y, z) by a
  const cx = a2 * z - a3 * y + a0 * x, cy = a3 * x - a1 * z + a0 * y, cz = a1 * y - a2 * x + a0 * z;
  out[o] = x + 2 * (a2 * cz - a3 * cy) + tx; out[o + 1] = y + 2 * (a3 * cx - a1 * cz) + ty; out[o + 2] = z + 2 * (a1 * cy - a2 * cx) + tz;
}
// solve A q = r for the 3x3 A of M (column-major: columns M[0..2], M[3..5], M[6..8]); returns false if singular
function solve3(M, rx, ry, rz, out, o) {
  const a = M[0], b = M[3], c = M[6], d = M[1], e = M[4], f = M[7], g = M[2], hh = M[5], i = M[8];
  const A = e * i - f * hh, B = -(d * i - f * g), C = d * hh - e * g, det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return false;
  out[o] = (A * rx + (c * hh - b * i) * ry + (b * f - c * e) * rz) / det;
  out[o + 1] = (B * rx + (a * i - c * g) * ry + (c * d - a * f) * rz) / det;
  out[o + 2] = (C * rx + (b * g - a * hh) * ry + (a * e - b * d) * rz) / det; return true;
}
// put the bind back as built (undo the last girdleRelax7 on this hero's body); a no-op when there is nothing to undo
export function girdleReset7(h) {
  const g = h?.body?.geometry, C = g && _gr.get(g), S = C?.saved; if (!S) return false;
  const X = g.attributes.position.array, N = g.attributes.normal.array;
  for (let i = 0; i < S.idx.length; i++) { const v = S.idx[i]; for (let j = 0; j < 3; j++) { X[3 * v + j] = S.pos[3 * i + j]; N[3 * v + j] = S.nrm[3 * i + j]; } }
  for (const [key, x, y, z] of S.areo || []) { const u = h.likeness?.skin?.U?.[key]?.value; if (u) { u.x = x; u.y = y; u.z = z; } }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; C.saved = null; return true;
}
// h: the posed hero after the girdle (and the hand clearance); BM0: the skin matrices of the stance alone; GH0: the shoulder joints then (world)
// (c3, 8 Oct) a bind edit made AFTER the girdle (body/membrane7.js fitSkin7: the skin fitted onto a solved envelope) must survive the next
// girdleReset7: girdleSaved7 gives the as-built bind of the relaxed band ({ idx, pos } or null); girdleBindEdit7 adds the same per-vertex bind
// delta D (Float32Array or Float64Array, 3 x vertices) to that saved copy, so a reset restores 'as built + the edit'
export function girdleSaved7(h) { const g = h?.body?.geometry, C = g && _gr.get(g); return C?.saved ? { idx: C.saved.idx, pos: C.saved.pos } : null; }
export function girdleBindEdit7(h, D) { const g = h?.body?.geometry, C = g && _gr.get(g), S = C?.saved; if (!S || !D) return 0;
  for (let i = 0; i < S.idx.length; i++) { const v = S.idx[i]; S.pos[3 * i] += D[3 * v]; S.pos[3 * i + 1] += D[3 * v + 1]; S.pos[3 * i + 2] += D[3 * v + 2]; } return S.idx.length; }
export function girdleRelax7(h, BM0, GH0, { aHi = GR7.aHi, rb = GR7.rb, rbArm = GR7.rbArm, keepR = GR7.keepR, omega = GR7.omega, tol = GR7.tol, maxIt = GR7.maxIt, neckLo = GR7.neckLo, neckH = GR7.neckH, neckLam = GR7.neckLam } = {}) {
  const m = h?.body, g = m?.geometry; if (!g?.index || !BM0) return null;
  const t0 = Date.now(), C = grIndex(g), { off, nb, toff, vt } = C, I = g.index.array, X = g.attributes.position.array, N = g.attributes.normal.array;
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, REG = g.attributes.aHero?.array, n = g.attributes.position.count;
  const BM1 = skinMatrices7(h), P0 = new Float64Array(3 * n), P1 = new Float64Array(3 * n);
  for (let v = 0; v < n; v++) { skin7(X, SI, SW, BM0, v, P0, 3 * v); skin7(X, SI, SW, BM1, v, P1, 3 * v); }
  let y0 = Infinity, y1 = -Infinity; for (let v = 0; v < n; v++) { y0 = Math.min(y0, P0[3 * v + 1]); y1 = Math.max(y1, P0[3 * v + 1]); }
  const H = y1 - y0, idx = new Map(h.bones.map((b, i) => [b, i])), skip = new Uint8Array(n), free = new Uint8Array(n), stats = { version: GR7.version };
  if (REG) for (let v = 0; v < n; v++) { const r = Math.round(REG[4 * v]); if (r === 0 || r === 11 || r === 5 || r === 6) skip[v] = 1; }   // head, jaw, hand, finger
  // GR7 v2: the neck (region 1) and everything above neckH of stature keep the girdle's own displacement
  let lam = null;
  { let k = 0, ks = 0; lam = new Float32Array(n); const yA = y0 + neckLo * H, yB = y0 + neckH * H;
    for (let v = 0; v < n; v++) { if (skip[v]) continue; if (REG && Math.round(REG[4 * v]) === 1) { skip[v] = 1; k++; continue; }
      const y = P0[3 * v + 1]; if (y <= yA) continue; const t = Math.min(1, (y - yA) / Math.max(1e-9, yB - yA)); lam[v] = neckLam * t * t * (3 - 2 * t); ks++; }
    stats.neckHeld = k; stats.neckSoft = ks; }
  // keepR around the nipple-areola (nippleAt, bind space -> the nearest vertex's posed position): the band does not move it
  const nip = [];
  try { const NP = nippleAt(h, { sex: h.sex, scale: 1 / (h.scale || 1) }); for (const q of [NP.L, NP.R]) { let bi = 0, bd = Infinity;
      for (let v = 0; v < n; v++) { const d = (X[3 * v] - q[0]) ** 2 + (X[3 * v + 1] - q[1]) ** 2 + (X[3 * v + 2] - q[2]) ** 2; if (d < bd) { bd = d; bi = v; } }
      nip.push(bi); const R2 = (keepR * H) ** 2; if (keepR > 0) for (let v = 0; v < n; v++) if ((P0[3 * v] - P0[3 * bi]) ** 2 + (P0[3 * v + 1] - P0[3 * bi + 1]) ** 2 + (P0[3 * v + 2] - P0[3 * bi + 2]) ** 2 < R2) skip[v] = 1; } } catch (e) { stats.keep = 'nippleAt: ' + (e?.message || e); }
  // the band, per side: Dijkstra along the posed surface from the border of the arm's rigid part
  const heap = [], dist = new Float64Array(n);
  const push = (d, v) => { heap.push(d, v); let i = heap.length / 2 - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[2 * p] <= heap[2 * i]) break; for (const k of [0, 1]) { const t = heap[2 * p + k]; heap[2 * p + k] = heap[2 * i + k]; heap[2 * i + k] = t; } i = p; } };
  const pop = () => { const d = heap[0], v = heap[1], ld = heap[heap.length - 2], lv = heap[heap.length - 1]; heap.length -= 2; const L = heap.length / 2;
    if (L) { heap[0] = ld; heap[1] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < L && heap[2 * l] < heap[2 * s]) s = l; if (r < L && heap[2 * r] < heap[2 * s]) s = r; if (s === i) break; for (const k of [0, 1]) { const t = heap[2 * s + k]; heap[2 * s + k] = heap[2 * i + k]; heap[2 * i + k] = t; } i = s; } } return [d, v]; };
  const len = (u, v) => Math.hypot(P0[3 * u] - P0[3 * v], P0[3 * u + 1] - P0[3 * v + 1], P0[3 * u + 2] - P0[3 * v + 2]);
  const grow = (seed, ok, R) => { dist.fill(Infinity); for (const v of seed) { dist[v] = 0; push(0, v); }
    while (heap.length) { const [d, v] = pop(); if (d > dist[v]) continue; for (let k = off[v]; k < off[v + 1]; k++) { const u = nb[k]; if (!ok(u)) continue; const du = d + len(u, v); if (du < dist[u] && du < R) { dist[u] = du; push(du, u); } } } };
  let nArm = 0, nTrunk = 0; const mid = GH0?.L && GH0?.R ? GH0.L.clone().add(GH0.R).multiplyScalar(0.5) : null, lat = mid ? GH0.L.clone().sub(GH0.R).normalize() : null;
  for (const s of ['L', 'R']) {
    const mv = new Uint8Array(BM0.length / 16); h.bone('clavicle.' + s).traverse(b => { if (idx.has(b)) mv[idx.get(b)] = 1; });
    const a = new Float32Array(n); for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) if (mv[SI[4 * v + k]]) a[v] += SW[4 * v + k];
    const border = []; for (let v = 0; v < n; v++) if (a[v] >= aHi && !skip[v]) for (let k = off[v]; k < off[v + 1]; k++) if (a[nb[k]] < aHi) { border.push(v); break; }
    grow(border, u => a[u] < aHi && !skip[u], rb * H); for (let v = 0; v < n; v++) if (dist[v] < rb * H && dist[v] > 0) { if (!free[v]) nTrunk++; free[v] = 1; }
    if (rbArm > 0) { const G = GH0?.[s], yGH = G?.y ?? Infinity, sg = s === 'L' ? 1 : -1;
      // the arm side only below the shoulder joint and medial of it (the axilla, its folds and the inner arm; not the deltoid's cap or its outer face)
      const medial = u => !G || !lat ? true : sg * ((P0[3 * u] - mid.x) * lat.x + (P0[3 * u + 1] - mid.y) * lat.y + (P0[3 * u + 2] - mid.z) * lat.z) < sg * ((G.x - mid.x) * lat.x + (G.y - mid.y) * lat.y + (G.z - mid.z) * lat.z);
      grow(border, u => a[u] >= aHi && !skip[u] && P0[3 * u + 1] < yGH && medial(u), rbArm * H);
      for (let v = 0; v < n; v++) if (dist[v] < rbArm * H) { if (!free[v]) nArm++; free[v] = 1; } }
  }
  const F = []; for (let v = 0; v < n; v++) if (free[v] && !skip[v]) F.push(v);
  // the harmonic field on the band (Dirichlet: the girdle's own displacement everywhere else)
  const S = new Float64Array(3 * n); for (let i = 0; i < 3 * n; i++) S[i] = P1[i] - P0[i];
  let its = 0, res = 0;
  for (; its < maxIt; its++) { res = 0;
    for (const v of F) { const c = off[v + 1] - off[v]; let sx = 0, sy = 0, sz = 0; for (let k = off[v]; k < off[v + 1]; k++) { const u = 3 * nb[k]; sx += S[u]; sy += S[u + 1]; sz += S[u + 2]; }
      const o = 3 * v; let tx = sx / c, ty = sy / c, tz = sz / c;
      if (lam && lam[v]) { const l = lam[v]; tx = (tx + l * (P1[o] - P0[o])) / (1 + l); ty = (ty + l * (P1[o + 1] - P0[o + 1])) / (1 + l); tz = (tz + l * (P1[o + 2] - P0[o + 2])) / (1 + l); }   // GR7 v2: screened toward the girdle's own displacement near the neck
      const dx = omega * (tx - S[o]), dy = omega * (ty - S[o + 1]), dz = omega * (tz - S[o + 2]); S[o] += dx; S[o + 1] += dy; S[o + 2] += dz; res = Math.max(res, Math.abs(dx), Math.abs(dy), Math.abs(dz)); }
    if (res < tol) break; }
  // back to the bind: b' = M1^-1 (P0 + S); the normals of the band and its ring from the posed surface, back through M1
  const ring = new Uint8Array(n); for (const v of F) { ring[v] = 1; for (let k = off[v]; k < off[v + 1]; k++) ring[nb[k]] = 1; }
  const touched = []; for (let v = 0; v < n; v++) if (ring[v]) touched.push(v);
  const saved = { idx: Int32Array.from(touched), pos: new Float32Array(3 * touched.length), nrm: new Float32Array(3 * touched.length) };
  touched.forEach((v, i) => { for (let j = 0; j < 3; j++) { saved.pos[3 * i + j] = X[3 * v + j]; saved.nrm[3 * i + j] = N[3 * v + j]; } });
  const Pf = P1, M = new Float64Array(12), tmp = new Float64Array(3), q = new Float64Array(3); let moved = 0, maxMm = 0, sumMm = 0;
  for (const v of F) { const o = 3 * v; Pf[o] = P0[o] + S[o]; Pf[o + 1] = P0[o + 1] + S[o + 1]; Pf[o + 2] = P0[o + 2] + S[o + 2]; }
  for (const v of F) { skin7(X, SI, SW, BM1, v, tmp, 0, M); const o = 3 * v;
    if (!solve3(M, Pf[o] - M[9], Pf[o + 1] - M[10], Pf[o + 2] - M[11], q, 0) || !Number.isFinite(q[0] + q[1] + q[2])) continue;
    const d = Math.hypot(q[0] - X[o], q[1] - X[o + 1], q[2] - X[o + 2]) * (h.scale || 1) * 1000; maxMm = Math.max(maxMm, d); sumMm += d; moved++;
    X[o] = q[0]; X[o + 1] = q[1]; X[o + 2] = q[2]; }
  for (const v of touched) { let nx = 0, ny = 0, nz = 0;
    for (let k = toff[v]; k < toff[v + 1]; k++) { const t = vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ux = Pf[b] - Pf[a], uy = Pf[b + 1] - Pf[a + 1], uz = Pf[b + 2] - Pf[a + 2], wx = Pf[c] - Pf[a], wy = Pf[c + 1] - Pf[a + 1], wz = Pf[c + 2] - Pf[a + 2];
      nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nz += ux * wy - uy * wx; }
    skin7(X, SI, SW, BM1, v, tmp, 0, M); if (!solve3(M, nx, ny, nz, q, 0)) continue; const l = Math.hypot(q[0], q[1], q[2]) || 1, o = 3 * v;
    N[o] = q[0] / l; N[o + 1] = q[1] / l; N[o + 2] = q[2] / l; }
  // the bind shift at the nipple-areola's vertex (a paint read in bind space slides on the skin by this much there; mm)
  stats.nippleShiftMm = nip.map(v => { const i = touched.indexOf(v); return i < 0 ? 0 : +(Math.hypot(X[3 * v] - saved.pos[3 * i], X[3 * v + 1] - saved.pos[3 * i + 1], X[3 * v + 2] - saved.pos[3 * i + 2]) * (h.scale || 1) * 1000).toFixed(1); });
  // SKIN7's painted areola (likeness/skin.js: uniforms likeAreo0 / likeAreo1, the centre in bind space) follows the relaxed skin: its centre
  // takes the bind shift of the skin vertex under it (none when that vertex is outside the band), so the paint and the relief stay together;
  // restored by girdleReset7
  const U = h.likeness?.skin?.U; saved.areo = [];
  const tIdx = new Int32Array(n).fill(-1); touched.forEach((v, i) => { tIdx[v] = i; });
  const bind0 = v => tIdx[v] < 0 ? [X[3 * v], X[3 * v + 1], X[3 * v + 2]] : [saved.pos[3 * tIdx[v]], saved.pos[3 * tIdx[v] + 1], saved.pos[3 * tIdx[v] + 2]];
  for (const key of ['likeAreo0', 'likeAreo1']) { const u = U?.[key]?.value; if (!u || !(u.x || u.y || u.z)) continue; let v = -1, bd = Infinity;
    for (let w = 0; w < n; w++) { const b = bind0(w), d = (b[0] - u.x) ** 2 + (b[1] - u.y) ** 2 + (b[2] - u.z) ** 2; if (d < bd) { bd = d; v = w; } }   // the skin under the centre
    const i = tIdx[v]; if (i < 0) { (stats.areolaMm ||= []).push(0); continue; }
    const dx = X[3 * v] - saved.pos[3 * i], dy = X[3 * v + 1] - saved.pos[3 * i + 1], dz = X[3 * v + 2] - saved.pos[3 * i + 2];
    saved.areo.push([key, u.x, u.y, u.z]); u.x += dx; u.y += dy; u.z += dz; (stats.areolaMm ||= []).push(+(Math.hypot(dx, dy, dz) * (h.scale || 1) * 1000).toFixed(1)); }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; C.saved = saved;
  Object.assign(stats, { band: F.length, arm: nArm, trunk: nTrunk, its, res: +res.toExponential(2), bindMeanMm: +(sumMm / Math.max(1, moved)).toFixed(2), bindMaxMm: +maxMm.toFixed(1), ms: Date.now() - t0 });
  return stats;
}

// ---------------------------------------------------------------- c4 (BODY7 c4 iteration 1, 15 Oct): the skin slides over the posed girdle
// SEEN (the orchestrator's read of clay 1008-215423 / 1009-000713, profile and three-quarter: a torn-looking notch at the side of the neck base
// behind on L08, a lumpy knob at the top of the shoulder on L21; both columns) and MEASURED (node, labs/human8/body7_c4_scratch/nape_probe.mjs):
// the hm08 skin at the lateral neck base and over the upper trapezius folds (edges 40-56 deg between neighbouring triangles where the bind has
// 5-11), and at the axillae (8-22 edges past 90 deg) IN THE STANCE ALONE, before the girdle: linear blend skinning. Lowering the arm from the
// A-pose and turning the neck pull vertices with blended weights (neck01 / clavicle / spine01 / upperarm01) along chords between their bones'
// transforms, so a strip of skin is compressed into a crease. A real skin does not crease there: it is a membrane anchored to the fascia that
// slides over the trapezius and the deltoid and keeps its own shape (its local curvature) while the tissue under it moves.
// THE CHANGE: after the stance, the girdle and its relaxation, the skin of the neck base, the shoulder, the axilla and the upper back and chest
// is re-laid over the posed body by DELTA MUSH (Mancewicz et al. 2014): the posed surface is smoothed (Laplacian, uniform, `its` sweeps of
// `lam`, the vertices outside the zone held), and each vertex's own detail (its bind position against the bind surface smoothed the same way)
// is put back in the posed smoothed surface's local frame (the normal and a tangent), so the folds LBS made (which the smoothed surface does not
// have) go, and the anatomy the bind carries (clavicles, the notch, the muscles' relief: the detail) stays. The zone: hm08 regions neck (1),
// torso (2) and upper arm (3) whose skin weights are not a single bone's (max weight < `rigid`) above the lower chest (posed height over the
// shoulder joints' mean minus `below` of stature), blended in over `ramp` rings from its edge, so nothing outside it moves. The result is
// written back into the BIND positions through each vertex's blended skin matrix (as girdleRelax7 does), into girdle7's saved copy (so
// girdleReset7 restores the as-built bind and the soft hooks' bind edits survive), the normals rebuilt. No new attribute, no shader change.
// Pure geometry of the pose: it holds for any person, any stance and any clip frame that calls girdle7 (afterPose7). slideOpts: false = off (a caller's own choice; the A/B switch went when the orchestrator ruled SL7 KEEP, 15 Oct 08:40).
// c5 it1 (15 Oct): THE TRAPEZIUS SHEET (SL7 v2, `sheet`). SEEN on clay 1015-055130 (the orchestrator's read and mine at 1:1): with the slide on,
// L08 / L06 in profile keep a row of small hooked slits along the top of the shoulder behind the clavicle, and L21 a knob on top of the shoulder.
// MEASURED (labs/human8/body7_c5_scratch/shoulder_probe.mjs): the slits are single edges of 25-45 deg (the bind 15-19) on a line on each side,
// x 10-14 cm off the midline, 0-4 cm under neck01, just behind the shoulder joints' plane, where four bones share the skin (neck01, spine01,
// clavicle, shoulder01: the hm08 weights' seam); SL7 put the bind's own crease back there (the delta it restores is the bind's detail), and the
// arm's region (3) on the top of the shoulder was outside its zone. ANATOMY: that territory is the upper trapezius, one thin muscle sheet from
// the occiput, the nuchal ligament and C7 to the lateral clavicle, the acromion and the spine of the scapula, under 3-15 mm of subcutaneous fat
// (more in women); its surface is the sheet's: a tissue of that thickness under tension cannot carry relief shorter than itself, so a
// crease line of single edges, or a knob, is not anatomy there. THE CHANGE: inside the upper trapezius' territory (from the person's own
// skeleton and weights: skin carried by the girdle-neck bones (neck01 / spine01 / clavicle / shoulder01) more than by the arm, above the
// acromion's height over the shoulder joints and behind the coronal plane through them; a smooth weight T in [0, 1]), the zone takes the arm's
// region too, and the bind detail SL7 restores is low-passed over the sheet (`sheetIts` Laplacian sweeps of the detail vectors, in bind space):
// the detail longer than the sheet's thickness (the clavicle's line in front, the trapezius' slope) stays, the short (the seam crease, the
// knob) goes. Outside the territory SL7 is v1 to the bit. Any person, any stance or clip frame through girdle7. RULED KEEP by the orchestrator
// from clay 1015-093925 (15 Oct ~17:45): the switch (`sheet`, --no-sheet, clay side nosheet) is deleted (c6 it1); git history has it.
export const SL7 = { version: 2, its: 12, lam: 0.5, rigid: 0.97, below: 0, ramp: 3, arm: false, sheetIts: 10, sheetLam: 0.5, acr: 0.015, acrRamp: 0.02, plane: 0.01 };
const TRAP_B7 = /^(neck01|spine01|clavicle\.[LR]|shoulder01\.[LR])$/, TRAP_ARM7 = /^upperarm0\d\.[LR]$/, TRAP_HEAD7 = /^(neck02|neck03|head)$/;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function skinSlide7(h, { its = SL7.its, lam = SL7.lam, rigid = SL7.rigid, below = SL7.below, ramp = SL7.ramp, arm = SL7.arm, sheetIts = SL7.sheetIts, sheetLam = SL7.sheetLam, acr = SL7.acr, acrRamp = SL7.acrRamp, plane = SL7.plane } = {}) {
  const m = h?.body, g = m?.geometry; if (!g?.index || !g.attributes.aHero) return null;
  const t0 = Date.now(), C = grIndex(g), { off, nb, toff, vt } = C, I = g.index.array, X = g.attributes.position.array, N = g.attributes.normal.array;
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, REG = g.attributes.aHero.array, n = g.attributes.position.count;
  const BM = skinMatrices7(h), P = new Float64Array(3 * n); for (let v = 0; v < n; v++) skin7(X, SI, SW, BM, v, P, 3 * v);
  let y0 = Infinity, y1 = -Infinity; for (let v = 0; v < n; v++) { y0 = Math.min(y0, P[3 * v + 1]); y1 = Math.max(y1, P[3 * v + 1]); }
  const H = y1 - y0, yS = (h.joint('upperarm01.L').y + h.joint('upperarm01.R').y) / 2, yLo = yS - below * H;
  const inTri = new Uint8Array(n); for (let i = 0; i < I.length; i++) inTri[I[i]] = 1;
  // the upper trapezius' territory T (c5 it1): girdle-neck bones over the arm, above the acromion's height, behind the shoulder joints' coronal plane
  const T = new Float32Array(n); let nT = 0;
  { const bn = m.skeleton.bones.map(b => b.name), isT = bn.map(b => TRAP_B7.test(b)), isA = bn.map(b => TRAP_ARM7.test(b)), isH = bn.map(b => TRAP_HEAD7.test(b));
    const jL = h.joint('upperarm01.L'), jR = h.joint('upperarm01.R'), zS = (jL.z + jR.z) / 2, fw = h.joint('eye.L').z > zS ? 1 : -1;
    for (let v = 0; v < n; v++) { if (!inTri[v]) continue; const r = Math.round(REG[4 * v]); if (r !== 1 && r !== 2 && r !== 3) continue;
      let wt = 0, wa = 0, wh = 0; for (let k = 0; k < 4; k++) { const b = SI[4 * v + k], w = SW[4 * v + k]; if (isT[b]) wt += w; else if (isA[b]) wa += w; else if (isH[b]) wh += w; }
      const t = sstep(0.35, 0.6, wt) * (1 - sstep(0.3, 0.5, wa)) * (1 - sstep(0.25, 0.45, wh)) * sstep(yS + acr * H, yS + (acr + acrRamp) * H, P[3 * v + 1])
        * (1 - sstep(-plane, plane, fw * (P[3 * v + 2] - zS) - plane));
      if (t > 1e-3) { T[v] = t; nT++; } } }
  const zone = new Uint8Array(n); let nz = 0;
  for (let v = 0; v < n; v++) { if (!inTri[v]) continue; if (T[v] > 0) { zone[v] = 1; nz++; continue; } const r = Math.round(REG[4 * v]); if (r !== 1 && r !== 2 && !(arm && r === 3)) continue; if (P[3 * v + 1] < yLo) continue;
    let mw = 0; for (let k = 0; k < 4; k++) mw = Math.max(mw, SW[4 * v + k]); if (mw >= rigid) continue; zone[v] = 1; nz++; }
  // the blend: rings from the zone's edge (1 at `ramp` rings in)
  const ring = new Int32Array(n).fill(-1); let fr = []; for (let v = 0; v < n; v++) if (zone[v]) { for (let k = off[v]; k < off[v + 1]; k++) if (!zone[nb[k]]) { ring[v] = 0; fr.push(v); break; } }
  for (let d = 1; d <= ramp && fr.length; d++) { const nf = []; for (const v of fr) for (let k = off[v]; k < off[v + 1]; k++) { const u = nb[k]; if (zone[u] && ring[u] < 0) { ring[u] = d; nf.push(u); } } fr = nf; }
  const Z = []; for (let v = 0; v < n; v++) if (zone[v]) Z.push(v);
  const wOf = v => ring[v] < 0 ? 1 : (ring[v] + 1) / (ramp + 1);
  const smooth = (A) => { const S = Float64Array.from(A), T = new Float64Array(3 * Z.length);
    for (let it = 0; it < its; it++) { Z.forEach((v, i) => { const c = off[v + 1] - off[v]; let sx = 0, sy = 0, sz = 0; for (let k = off[v]; k < off[v + 1]; k++) { const u = 3 * nb[k]; sx += S[u]; sy += S[u + 1]; sz += S[u + 2]; }
        const o = 3 * v; T[3 * i] = S[o] + lam * (sx / c - S[o]); T[3 * i + 1] = S[o + 1] + lam * (sy / c - S[o + 1]); T[3 * i + 2] = S[o + 2] + lam * (sz / c - S[o + 2]); });
      Z.forEach((v, i) => { S[3 * v] = T[3 * i]; S[3 * v + 1] = T[3 * i + 1]; S[3 * v + 2] = T[3 * i + 2]; }); }
    return S; };
  // a vertex frame on a surface A: the area-weighted normal and the first neighbour's edge made orthogonal to it
  const frame = (A, v) => { let nx = 0, ny = 0, nzz = 0;
    for (let k = toff[v]; k < toff[v + 1]; k++) { const t = vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ux = A[b] - A[a], uy = A[b + 1] - A[a + 1], uz = A[b + 2] - A[a + 2], wx = A[c] - A[a], wy = A[c + 1] - A[a + 1], wz = A[c + 2] - A[a + 2];
      nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nzz += ux * wy - uy * wx; }
    let l = Math.hypot(nx, ny, nzz) || 1; nx /= l; ny /= l; nzz /= l; const u = 3 * nb[off[v]], o = 3 * v;
    let tx = A[u] - A[o], ty = A[u + 1] - A[o + 1], tz = A[u + 2] - A[o + 2]; const d = tx * nx + ty * ny + tz * nzz; tx -= d * nx; ty -= d * ny; tz -= d * nzz;
    l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l; return [tx, ty, tz, ny * tz - nzz * ty, nzz * tx - nx * tz, nx * ty - ny * tx, nx, ny, nzz]; };
  const B = Float64Array.from(X), Bs = smooth(B), Ps = smooth(P), M = new Float64Array(12), tmp = new Float64Array(3), q = new Float64Array(3);
  // saved: the as-built bind of every vertex this touches (merged into girdleRelax7's copy, so girdleReset7 restores both)
  const touch = new Uint8Array(n); for (const v of Z) { touch[v] = 1; for (let k = off[v]; k < off[v + 1]; k++) touch[nb[k]] = 1; }
  const S0 = C.saved, have = new Set(S0 ? S0.idx : []), add = []; for (let v = 0; v < n; v++) if (touch[v] && !have.has(v)) add.push(v);
  const idx = new Int32Array((S0 ? S0.idx.length : 0) + add.length), pos = new Float32Array(3 * idx.length), nrm = new Float32Array(3 * idx.length); let j0 = 0;
  if (S0) { idx.set(S0.idx); pos.set(S0.pos); nrm.set(S0.nrm); j0 = S0.idx.length; }
  add.forEach((v, i) => { idx[j0 + i] = v; for (let j = 0; j < 3; j++) { pos[3 * (j0 + i) + j] = X[3 * v + j]; nrm[3 * (j0 + i) + j] = N[3 * v + j]; } });
  C.saved = { idx, pos, nrm, areo: S0?.areo || [] };
  // the sheet: the bind detail (B - Bs, bind space) low-passed over the zone where T > 0 (the zone's other vertices keep theirs)
  const D = new Float64Array(3 * n); for (const v of Z) for (let j = 0; j < 3; j++) D[3 * v + j] = B[3 * v + j] - Bs[3 * v + j];
  if (nT) { const Ds = Float64Array.from(D), Tm = new Float64Array(3 * Z.length);
    for (let it = 0; it < sheetIts; it++) { Z.forEach((v, i) => { let c = 0, sx = 0, sy = 0, sz = 0; for (let k = off[v]; k < off[v + 1]; k++) { const u = nb[k]; if (!zone[u]) continue; c++; sx += Ds[3 * u]; sy += Ds[3 * u + 1]; sz += Ds[3 * u + 2]; }
        const o = 3 * v; if (!c) { Tm[3 * i] = Ds[o]; Tm[3 * i + 1] = Ds[o + 1]; Tm[3 * i + 2] = Ds[o + 2]; return; }
        Tm[3 * i] = Ds[o] + sheetLam * (sx / c - Ds[o]); Tm[3 * i + 1] = Ds[o + 1] + sheetLam * (sy / c - Ds[o + 1]); Tm[3 * i + 2] = Ds[o + 2] + sheetLam * (sz / c - Ds[o + 2]); });
      Z.forEach((v, i) => { Ds[3 * v] = Tm[3 * i]; Ds[3 * v + 1] = Tm[3 * i + 1]; Ds[3 * v + 2] = Tm[3 * i + 2]; }); }
    for (const v of Z) { const t = T[v]; if (!t) continue; for (let j = 0; j < 3; j++) D[3 * v + j] += t * (Ds[3 * v + j] - D[3 * v + j]); } }
  const Pf = Float64Array.from(P); let moved = 0, sum = 0, mx = 0;
  for (const v of Z) { const o = 3 * v, fb = frame(Bs, v), fp = frame(Ps, v), dx = D[o], dy = D[o + 1], dz = D[o + 2];
    // the bind's detail in the bind-smoothed frame, rotated by the skin's own transform (bind is in model space; P in world: the blended matrix's 3x3 carries scale)
    const a = dx * fb[0] + dy * fb[1] + dz * fb[2], b = dx * fb[3] + dy * fb[4] + dz * fb[5], c = dx * fb[6] + dy * fb[7] + dz * fb[8];
    skin7(X, SI, SW, BM, v, tmp, 0, M); const sc = Math.cbrt(Math.abs(M[0] * (M[4] * M[8] - M[7] * M[5]) - M[3] * (M[1] * M[8] - M[7] * M[2]) + M[6] * (M[1] * M[5] - M[4] * M[2]))) || 1;
    const w = wOf(v), tx = Ps[o] + sc * (a * fp[0] + b * fp[3] + c * fp[6]), ty = Ps[o + 1] + sc * (a * fp[1] + b * fp[4] + c * fp[7]), tz = Ps[o + 2] + sc * (a * fp[2] + b * fp[5] + c * fp[8]);
    Pf[o] = P[o] + w * (tx - P[o]); Pf[o + 1] = P[o + 1] + w * (ty - P[o + 1]); Pf[o + 2] = P[o + 2] + w * (tz - P[o + 2]); }
  for (const v of Z) { const o = 3 * v; skin7(X, SI, SW, BM, v, tmp, 0, M); if (!solve3(M, Pf[o] - M[9], Pf[o + 1] - M[10], Pf[o + 2] - M[11], q, 0) || !Number.isFinite(q[0] + q[1] + q[2])) continue;
    const d = Math.hypot(Pf[o] - P[o], Pf[o + 1] - P[o + 1], Pf[o + 2] - P[o + 2]) / (h.group?.scale?.y || 1) * 1000; sum += d; mx = Math.max(mx, d); moved++;
    X[o] = q[0]; X[o + 1] = q[1]; X[o + 2] = q[2]; }
  for (let v = 0; v < n; v++) { if (!touch[v]) continue; let nx = 0, ny = 0, nzz = 0;
    for (let k = toff[v]; k < toff[v + 1]; k++) { const t = vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ux = Pf[b] - Pf[a], uy = Pf[b + 1] - Pf[a + 1], uz = Pf[b + 2] - Pf[a + 2], wx = Pf[c] - Pf[a], wy = Pf[c + 1] - Pf[a + 1], wz = Pf[c + 2] - Pf[a + 2];
      nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nzz += ux * wy - uy * wx; }
    skin7(X, SI, SW, BM, v, tmp, 0, M); if (!solve3(M, nx, ny, nzz, q, 0) || !Number.isFinite(q[0] + q[1] + q[2])) continue; const l = Math.hypot(q[0], q[1], q[2]) || 1, o = 3 * v;
    N[o] = q[0] / l; N[o + 1] = q[1] / l; N[o + 2] = q[2] / l; }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  return { version: SL7.version, sheet: nT ? { territory: nT, its: sheetIts } : false, zone: nz, moved, meanMm: +(sum / Math.max(1, moved)).toFixed(2), maxMm: +mx.toFixed(1), ms: Date.now() - t0 };
}

// ---------------------------------------------------------------- c4 iteration 2 (BODY7, 15 Oct): THE AXILLA UNTANGLED (AX7 v1)
// The skin where the arm meets the trunk (the posterior and anterior axillary folds, the armpit's apex) is a sheet that LBS carries with
// chords between the trunk's and the arm's bone transforms; in the arm-down stance (after the girdle) a strip of it is driven through
// itself: 3-8 edges a side bent 120-172 deg (L08 x +-12-16 cm, 12-14 cm under neck01, both behind and in front of the axilla's plane)
// that the bind has at 6-47 deg. Real skin there compresses into a soft crease; it never turns over. The rule here is that physical
// constraint, not a shape: where the posed skin of the arm-trunk blend (weights shared between an arm bone and a trunk bone, regions
// torso / upper arm) is folded past `fold` deg and the bind is not (< `bindMax`), the folded vertices and `grow` rings round them relax
// as a membrane: Taubin smoothing (lam / mu, no shrinkage) of the POSED positions with the patch's edge held, blended in over the rings,
// until no edge in the patch is folded past `fold` or `maxIt` sweeps; a patch whose edge still folds grows once more (up to `regrow`).
// Written back into the bind through each vertex's blended skin matrix and into girdle7's saved copy (girdleReset7 restores), the normals
// rebuilt, as skinSlide7. Any person, any stance, any clip frame through girdle7; nothing per person. RULED KEEP (1015-093925): its switch is deleted (c6 it1).
// AX7 v2 (c5 iteration 2, BODY7, 15 Oct): DQS: the shared arm-trunk skin follows the blend of its bones' rigid motions (dual quaternions,
// dqs7) instead of the blend of their matrices, mixed in by how shared it is, so LBS' chord collapse is not made; contact and the Taubin
// fold relax follow as v1. (Tried and dropped: a uniform membrane relax: it turned triangles in the plane; body7_relax_test caught it.)
// RULED KEEP (1015-093925; no visible cost): v1 (LBS in the blend) and its switch are deleted (c6 it1); git history has them.
export const AX7 = { version: 2, fold: 90, bindMax: 60, grow: 3, regrow: 2, lam: 0.5, mu: -0.53, maxIt: 80, contact: true, band: 0.22, sep: 0.025, reach: 0.03, rounds: 12, spread: 6 };
const ARM_B7 = /^(upperarm0\d|shoulder01|clavicle)\.[LR]$/, TRUNK_B7 = /^(spine0\d|breast\.[LR]|pectoral\.[LR])$/;
export function axillaUntangle7(h, { fold = AX7.fold, bindMax = AX7.bindMax, grow = AX7.grow, regrow = AX7.regrow, lam = AX7.lam, mu = AX7.mu, maxIt = AX7.maxIt, contact = AX7.contact, band = AX7.band, sep = AX7.sep, reach = AX7.reach, rounds: cR = AX7.rounds, spread = AX7.spread } = {}) {
  const m = h?.body, g = m?.geometry; if (!g?.index || !g.attributes.aHero) return null;
  const t0 = Date.now(), C = grIndex(g), { off, nb, toff, vt } = C, I = g.index.array, X = g.attributes.position.array, N = g.attributes.normal.array;
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, REG = g.attributes.aHero.array, n = g.attributes.position.count;
  const bones = m.skeleton.bones.map(b => b.name), isArm = bones.map(b => ARM_B7.test(b)), isTrunk = bones.map(b => TRUNK_B7.test(b));
  const BM = skinMatrices7(h), P = new Float64Array(3 * n); for (let v = 0; v < n; v++) skin7(X, SI, SW, BM, v, P, 3 * v);
  // the arm-trunk blend: regions torso (2) / upper arm (3), skin shared by an arm bone and a trunk bone (each >= 0.05)
  const blend = new Uint8Array(n);
  for (let v = 0; v < n; v++) { const r = Math.round(REG[4 * v]); if (r !== 2 && r !== 3) continue; let wa = 0, wt = 0;
    for (let k = 0; k < 4; k++) { const w = SW[4 * v + k]; if (!w) continue; if (isArm[SI[4 * v + k]]) wa += w; else if (isTrunk[SI[4 * v + k]]) wt += w; }
    if (wa >= 0.05 && wt >= 0.05) blend[v] = 1; }
  // CONTACT (before the folds): the arm's skin and the trunk's skin under the shoulder meet; neither passes into the other. A vertex of
  // one (region 3 arm-weighted / region 2 trunk-weighted) that lies behind the nearest vertex of the other along that vertex's normal, and
  // was not its neighbour in the bind (bind distance > sep x stature: not the armpit's own continuous skin), goes half the depth out: both
  // tissues give and meet at a contact surface between them. The push spreads into the tissue round it (`spread` Laplacian sweeps of the
  // displacement field: soft tissue does not dent at a point) and the contact is solved again (`rounds`).
  const Pf = Float64Array.from(P), moved0 = new Uint8Array(n); let cIn = 0, cMax = 0, cAfter = 0, cMaxAfter = 0, nDq = 0;
  // AX7 v2 (`dqs`): the arm-trunk skin moves by the blend of its bones' RIGID motions (dual quaternions), mixed in by how shared it is
  // (min(arm, trunk weight) / 0.1, so it meets LBS continuously where one side owns the skin): the chord collapse that drove the
  // anterior and posterior axillary folds through themselves is not made in the first place; contact and the fold relax follow as v1.
  { const q = new Float64Array(3);
    for (let v = 0; v < n; v++) { const r = Math.round(REG[4 * v]); if (r !== 2 && r !== 3) continue; let wa = 0, wt = 0;
      for (let k = 0; k < 4; k++) { const w = SW[4 * v + k]; if (!w) continue; if (isArm[SI[4 * v + k]]) wa += w; else if (isTrunk[SI[4 * v + k]]) wt += w; }
      const t = clamp(Math.min(wa, wt) / 0.1, 0, 1); if (!t) continue; dqs7(X, SI, SW, BM, v, q, 0); if (!Number.isFinite(q[0] + q[1] + q[2])) continue;
      const o = 3 * v; for (let j = 0; j < 3; j++) Pf[o + j] = P[o + j] + t * (q[j] - P[o + j]); moved0[v] = 1; nDq++; } }
  if (contact) {
    let y0 = Infinity, y1 = -Infinity; for (let v = 0; v < n; v++) { y0 = Math.min(y0, P[3 * v + 1]); y1 = Math.max(y1, P[3 * v + 1]); }
    const H = y1 - y0, yS = (h.joint('upperarm01.L').y + h.joint('upperarm01.R').y) / 2, sc = h.group?.scale?.y || 1, sepB = sep * H / sc;
    const side = new Int8Array(n);   // 1 arm, 2 trunk
    for (let v = 0; v < n; v++) { const r = Math.round(REG[4 * v]); if ((r !== 2 && r !== 3) || P[3 * v + 1] > yS || P[3 * v + 1] < yS - band * H) continue; let wa = 0, wt = 0;
      for (let k = 0; k < 4; k++) { const w = SW[4 * v + k]; if (!w) continue; if (isArm[SI[4 * v + k]]) wa += w; else wt += w; }
      side[v] = r === 3 && wa >= 0.5 ? 1 : r === 2 && wt >= 0.5 ? 2 : 0; }
    const S = []; for (let v = 0; v < n; v++) if (side[v]) S.push(v);
    const Nv = new Float64Array(3 * n), D = new Float64Array(3 * n), cell = reach, key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    const vnorm = () => { for (const v of S) { let x = 0, y = 0, z = 0; for (let k = toff[v]; k < toff[v + 1]; k++) { const t = vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
        const ux = Pf[b] - Pf[a], uy = Pf[b + 1] - Pf[a + 1], uz = Pf[b + 2] - Pf[a + 2], wx = Pf[c] - Pf[a], wy = Pf[c + 1] - Pf[a + 1], wz = Pf[c + 2] - Pf[a + 2]; x += uy * wz - uz * wy; y += uz * wx - ux * wz; z += ux * wy - uy * wx; }
      const l = Math.hypot(x, y, z) || 1; Nv[3 * v] = x / l; Nv[3 * v + 1] = y / l; Nv[3 * v + 2] = z / l; } };
    const pass = (count) => { vnorm(); const grid = new Map(); for (const v of S) { const k = key(Pf[3 * v], Pf[3 * v + 1], Pf[3 * v + 2]); (grid.get(k) || grid.set(k, []).get(k)).push(v); }
      let k0 = 0, dm = 0; D.fill(0); const hit = [];
      for (const v of S) { const o = 3 * v, cx = Math.floor(Pf[o] / cell), cy = Math.floor(Pf[o + 1] / cell), cz = Math.floor(Pf[o + 2] / cell); let best = reach * reach, u = -1;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const w of grid.get(`${cx + a},${cy + b},${cz + c}`) || []) { if (side[w] === side[v]) continue;
          const d = (Pf[o] - Pf[3 * w]) ** 2 + (Pf[o + 1] - Pf[3 * w + 1]) ** 2 + (Pf[o + 2] - Pf[3 * w + 2]) ** 2; if (d < best) { best = d; u = w; } }
        if (u < 0 || Math.hypot(X[o] - X[3 * u], X[o + 1] - X[3 * u + 1], X[o + 2] - X[3 * u + 2]) < sepB) continue;
        const q3 = 3 * u, s_ = (Pf[o] - Pf[q3]) * Nv[q3] + (Pf[o + 1] - Pf[q3 + 1]) * Nv[q3 + 1] + (Pf[o + 2] - Pf[q3 + 2]) * Nv[q3 + 2]; if (s_ >= 0) continue;
        k0++; dm = Math.max(dm, -s_); hit.push(v); for (let j = 0; j < 3; j++) D[o + j] += -0.5 * s_ * Nv[q3 + j]; }
      if (count) return [k0, dm];
      // spread the push into the tissue round it (the zone: the hits and `spread` rings, same side, band only)
      const Zc = new Set(hit); let fr = hit.slice(); for (let d = 0; d < spread && fr.length; d++) { const nf = []; for (const v of fr) for (let j = off[v]; j < off[v + 1]; j++) { const u = nb[j]; if (!Zc.has(u) && side[u] === side[v]) { Zc.add(u); nf.push(u); } } fr = nf; }
      const Zl = [...Zc], T = new Float64Array(3 * Zl.length);
      for (let it = 0; it < spread; it++) { Zl.forEach((v, i) => { let sx = 0, sy = 0, sz = 0, c = 0; for (let j = off[v]; j < off[v + 1]; j++) { const u = 3 * nb[j]; sx += D[u]; sy += D[u + 1]; sz += D[u + 2]; c++; }
          // a hit keeps at least its own push (max along it), a neighbour takes the mean round it; a vertex of no triangle (no neighbours) keeps its own
          const o = 3 * v; if (!c) { T[3 * i] = D[o]; T[3 * i + 1] = D[o + 1]; T[3 * i + 2] = D[o + 2]; return; } T[3 * i] = 0.5 * (D[o] + sx / c); T[3 * i + 1] = 0.5 * (D[o + 1] + sy / c); T[3 * i + 2] = 0.5 * (D[o + 2] + sz / c); });
        Zl.forEach((v, i) => { const o = 3 * v; D[o] = T[3 * i]; D[o + 1] = T[3 * i + 1]; D[o + 2] = T[3 * i + 2]; }); }
      for (const v of Zl) { const o = 3 * v; Pf[o] += D[o]; Pf[o + 1] += D[o + 1]; Pf[o + 2] += D[o + 2]; moved0[v] = 1; }
      return [k0, dm]; };
    [cIn, cMax] = pass(true); for (let r = 0; r < cR; r++) pass(false); [cAfter, cMaxAfter] = pass(true);
  }
  const tn = (A, t, o) => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const ux = A[b] - A[a], uy = A[b + 1] - A[a + 1], uz = A[b + 2] - A[a + 2], wx = A[c] - A[a], wy = A[c + 1] - A[a + 1], wz = A[c + 2] - A[a + 2];
    let x = uy * wz - uz * wy, y = uz * wx - ux * wz, z = ux * wy - uy * wx; const l = Math.hypot(x, y, z) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; };
  // the edges (each once) with their two triangles
  const ET = []; { const seen = new Map(); for (let t = 0; t < I.length / 3; t++) for (let e = 0; e < 3; e++) { const a = I[3 * t + e], b = I[3 * t + (e + 1) % 3], k = a < b ? a * n + b : b * n + a; const s = seen.get(k); if (s === undefined) seen.set(k, ET.length / 4), ET.push(a, b, t, -1); else ET[4 * s + 3] = t; } }
  const na = new Float64Array(3), nbv = new Float64Array(3), cosF = Math.cos(fold * Math.PI / 180), cosB = Math.cos(bindMax * Math.PI / 180);
  const folded = (A, e) => { tn(A, ET[4 * e + 2], na); tn(A, ET[4 * e + 3], nbv); return na[0] * nbv[0] + na[1] * nbv[1] + na[2] * nbv[2] < cosF; };
  const cand = []; for (let e = 0; e < ET.length / 4; e++) { if (ET[4 * e + 3] < 0) continue; const a = ET[4 * e], b = ET[4 * e + 1]; if (blend[a] || blend[b]) cand.push(e); }
  const seeds = new Uint8Array(n); let nSeed = 0, before = 0, maxBefore = 0;
  const angOf = (A, e) => { tn(A, ET[4 * e + 2], na); tn(A, ET[4 * e + 3], nbv); return Math.acos(clamp(na[0] * nbv[0] + na[1] * nbv[1] + na[2] * nbv[2], -1, 1)) * 180 / Math.PI; };
  let raw = 0; for (const e of cand) if (folded(P, e)) raw++;
  for (const e of cand) { if (!folded(Pf, e)) continue; tn(X, ET[4 * e + 2], na); tn(X, ET[4 * e + 3], nbv); if (na[0] * nbv[0] + na[1] * nbv[1] + na[2] * nbv[2] < cosB) continue;
    before++; maxBefore = Math.max(maxBefore, angOf(Pf, e)); for (const v of [ET[4 * e], ET[4 * e + 1]]) if (!seeds[v]) { seeds[v] = 1; nSeed++; } }
  const zone = new Uint8Array(n), growZone = (from, k) => { let fr = []; for (let v = 0; v < n; v++) if (from[v]) { zone[v] = 1; fr.push(v); }
    for (let d = 0; d < k && fr.length; d++) { const nf = []; for (const v of fr) for (let j = off[v]; j < off[v + 1]; j++) { const u = nb[j]; const r = Math.round(REG[4 * u]); if (!zone[u] && (r === 2 || r === 3)) { zone[u] = 1; nf.push(u); } } fr = nf; } };
  if (nSeed) growZone(seeds, grow);
  let sweeps = 0, after = before, rounds = 0, Z = [];
  for (; nSeed && rounds <= regrow; rounds++) {
    Z = []; for (let v = 0; v < n; v++) if (zone[v]) Z.push(v);
    const ring = new Int32Array(n).fill(-1); let fr = []; for (const v of Z) { for (let j = off[v]; j < off[v + 1]; j++) if (!zone[nb[j]]) { ring[v] = 0; fr.push(v); break; } }
    for (let d = 1; d <= grow && fr.length; d++) { const nf = []; for (const v of fr) for (let j = off[v]; j < off[v + 1]; j++) { const u = nb[j]; if (zone[u] && ring[u] < 0) { ring[u] = d; nf.push(u); } } fr = nf; }
    const wv = Z.map(v => ring[v] < 0 ? 1 : ring[v] / (grow + 1)), T = new Float64Array(3 * Z.length), zE = cand.filter(e => zone[ET[4 * e]] && zone[ET[4 * e + 1]]);
    const step = (f) => { Z.forEach((v, i) => { const c = off[v + 1] - off[v]; let sx = 0, sy = 0, sz = 0; for (let j = off[v]; j < off[v + 1]; j++) { const u = 3 * nb[j]; sx += Pf[u]; sy += Pf[u + 1]; sz += Pf[u + 2]; }
      const o = 3 * v, w = c ? f * wv[i] : 0, mx_ = c ? sx / c : Pf[o], my_ = c ? sy / c : Pf[o + 1], mz_ = c ? sz / c : Pf[o + 2]; sx = mx_; sy = my_; sz = mz_; T[3 * i] = Pf[o] + w * (sx - Pf[o]); T[3 * i + 1] = Pf[o + 1] + w * (sy - Pf[o + 1]); T[3 * i + 2] = Pf[o + 2] + w * (sz - Pf[o + 2]); });
      Z.forEach((v, i) => { Pf[3 * v] = T[3 * i]; Pf[3 * v + 1] = T[3 * i + 1]; Pf[3 * v + 2] = T[3 * i + 2]; }); };
    for (let it = 0; it < maxIt; it++) { step(lam); step(mu); sweeps++; if (it % 4 === 3 && !zE.some(e => folded(Pf, e))) break; }
    // still folded at the patch's edge (where it is held): grow the patch round what remains
    const rest = new Uint8Array(n); let nr = 0; for (const e of cand) if (folded(Pf, e)) { const a = ET[4 * e], b = ET[4 * e + 1]; tn(X, ET[4 * e + 2], na); tn(X, ET[4 * e + 3], nbv); if (na[0] * nbv[0] + na[1] * nbv[1] + na[2] * nbv[2] < cosB) continue; rest[a] = rest[b] = 1; nr++; }
    after = nr; if (!nr || rounds === regrow) break; growZone(rest, grow);
  }
  let maxAfter = 0; for (const e of cand) { const a = ET[4 * e], b = ET[4 * e + 1]; if (zone[a] || zone[b]) maxAfter = Math.max(maxAfter, angOf(Pf, e)); }
  Z = []; for (let v = 0; v < n; v++) if (zone[v] || moved0[v]) Z.push(v);
  if (!Z.length) return { version: AX7.version, contact: [cIn, 0], folds: 0, moved: 0, ms: Date.now() - t0 };
  // saved: the as-built bind of every vertex this touches (merged into girdle7's copy, so girdleReset7 restores it)
  const touch = new Uint8Array(n); for (const v of Z) { touch[v] = 1; for (let j = off[v]; j < off[v + 1]; j++) touch[nb[j]] = 1; }
  const S0 = C.saved, have = new Set(S0 ? S0.idx : []), add = []; for (let v = 0; v < n; v++) if (touch[v] && !have.has(v)) add.push(v);
  const idx = new Int32Array((S0 ? S0.idx.length : 0) + add.length), pos = new Float32Array(3 * idx.length), nrm = new Float32Array(3 * idx.length); let j0 = 0;
  if (S0) { idx.set(S0.idx); pos.set(S0.pos); nrm.set(S0.nrm); j0 = S0.idx.length; }
  add.forEach((v, i) => { idx[j0 + i] = v; for (let j = 0; j < 3; j++) { pos[3 * (j0 + i) + j] = X[3 * v + j]; nrm[3 * (j0 + i) + j] = N[3 * v + j]; } });
  C.saved = { idx, pos, nrm, areo: S0?.areo || [] };
  const M = new Float64Array(12), tmp = new Float64Array(3), q = new Float64Array(3); let moved = 0, sum = 0, mx = 0;
  for (const v of Z) { const o = 3 * v; skin7(X, SI, SW, BM, v, tmp, 0, M); if (!solve3(M, Pf[o] - M[9], Pf[o + 1] - M[10], Pf[o + 2] - M[11], q, 0) || !Number.isFinite(q[0] + q[1] + q[2])) continue;
    const d = Math.hypot(Pf[o] - P[o], Pf[o + 1] - P[o + 1], Pf[o + 2] - P[o + 2]) / (h.group?.scale?.y || 1) * 1000; if (d > 1e-4) { sum += d; mx = Math.max(mx, d); moved++; }
    X[o] = q[0]; X[o + 1] = q[1]; X[o + 2] = q[2]; }
  for (let v = 0; v < n; v++) { if (!touch[v]) continue; let nx = 0, ny = 0, nzz = 0;
    for (let k = toff[v]; k < toff[v + 1]; k++) { const t = vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ux = Pf[b] - Pf[a], uy = Pf[b + 1] - Pf[a + 1], uz = Pf[b + 2] - Pf[a + 2], wx = Pf[c] - Pf[a], wy = Pf[c + 1] - Pf[a + 1], wz = Pf[c + 2] - Pf[a + 2];
      nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nzz += ux * wy - uy * wx; }
    skin7(X, SI, SW, BM, v, tmp, 0, M); if (!solve3(M, nx, ny, nzz, q, 0) || !Number.isFinite(q[0] + q[1] + q[2])) continue; const l = Math.hypot(q[0], q[1], q[2]) || 1, o = 3 * v;
    N[o] = q[0] / l; N[o + 1] = q[1] / l; N[o + 2] = q[2] / l; }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  return { version: AX7.version, dqs: nDq, contactIn: cIn, contactMaxMm: +(cMax * 1000).toFixed(1), contactAfter: cAfter, contactMaxMmAfter: +(cMaxAfter * 1000).toFixed(1), foldsRaw: raw, folds: before, foldsAfter: after, maxDegBefore: +maxBefore.toFixed(0), maxDegAfter: +maxAfter.toFixed(0), zone: Z.length, sweeps, rounds,
    moved, meanMm: +(sum / Math.max(1, moved)).toFixed(2), maxMm: +mx.toFixed(1), ms: Date.now() - t0 };
}
