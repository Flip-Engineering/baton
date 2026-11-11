// ANAT8-HEAD: the person's CRANIOMETRIC FRAME (8 Oct). Origin the bony porion midpoint, y up normal to the Frankfurt horizontal
// (porion - orbitale), x the person's left, z forward; millimetres. Built from the living head's landmarks (FACE P2's ids on hm08):
//  - bony PORION from the soft tragion (t): ~8 mm behind it (the meatus opens behind the tragus) and medial by the cartilaginous canal
//    and the soft tissue (bitragion ~ biporion + 26 mm in men, + 23 in women, as recalled from ANSUR bitragion vs Howells' AUB - 4)
//  - bony ORBITALE from P2's soft infraorbital site (or: 10 mm under the lower lid margin, under the pupil): 2.5 mm lower and back by
//    the site's tissue depth (the infraorbital margin lies ~18 mm under the pupil; the lid margin ~5.5, P2's site 10 more)
// headFrameFH(P, ids, { sex, depthOr }) -> { o (bind m), X, Y, Z (bind unit axes), toMm(p), toBind(q), po: { L, R }, or: { L, R } (mm) }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => mul(a, 1 / (Math.hypot(...a) || 1)), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function headFrameFH(P, ids, o = {}) {
  const g = k => [P[ids[k] * 3], P[ids[k] * 3 + 1], P[ids[k] * 3 + 2]], f = o.sex === 'f';
  // a first frame from the tragions and the nasion (directions only)
  const tL = g('t_L'), tR = g('t_R'), x0 = nrm(sub(tL, tR)), mid = mul(add(tL, tR), 0.5); let z0 = sub(g('n'), mid); z0 = nrm(sub(z0, mul(x0, dot(z0, x0)))); const y0 = cross(z0, x0);
  const medial = (f ? 11.5 : 13) / 1000, back = 0.008, dOr = (o.depthOr ?? (f ? 6.8 : 6.2)) / 1000;
  // the eyes' height fixes the vertical: the globe's centre sits ~18.5 mm (women) / 18.75 (men) over the orbitale (half the orbit's
  // height + 2; Howells' OBH means): the soft site P2 calls 'or' is a fixed hm08 vertex whose height under the eye varies by person
  const gY = o.globes ? s => { const G = o.globes[s > 0 ? 'L' : 'R'].c; return dot(sub(G, g(s > 0 ? 'or_L' : 'or_R')), y0) - (f ? 0.0185 : 0.01875); } : () => -0.0025;
  const po = s => { const t = s > 0 ? tL : tR; return add(add(t, mul(x0, -s * medial)), mul(z0, -back)); };
  const orb = s => add(add(g(s > 0 ? 'or_L' : 'or_R'), mul(y0, gY(s))), mul(z0, -dOr));
  const PoL = po(1), PoR = po(-1), OrM = mul(add(orb(1), orb(-1)), 0.5), O = mul(add(PoL, PoR), 0.5);
  const X = nrm(sub(PoL, PoR)); let Z = sub(OrM, O); Z = nrm(sub(Z, mul(X, dot(Z, X)))); const Y = cross(Z, X);
  const toMm = p => { const d = sub(p, O); return [dot(d, X) * 1000, dot(d, Y) * 1000, dot(d, Z) * 1000]; };
  const toBind = q => add(O, add(add(mul(X, q[0] / 1000), mul(Y, q[1] / 1000)), mul(Z, q[2] / 1000)));
  return { o: O, X, Y, Z, toMm, toBind, po: { L: toMm(PoL), R: toMm(PoR) }, or: { L: toMm(orb(1)), R: toMm(orb(-1)) }, lm: k => toMm(g(k)) };
}
// the living head's size anchors (mm) and its soft landmarks in the frame. (rev 4 of the skull) The draw is conditioned ONLY on the
// VAULT: gop, eueu and the scalp points; zyzy, nme, the menton, the chin and the globes are DESCRIPTIONS of the mesh (the scans
// instrument and the skull's report read them; skull.js drawSkull never builds bone from them; the globes are the lids' proxy).
// zyzy: the bizygomatic breadth measured on the mesh (the widest point of the face over the arch, between the eye's level and 15 mm
// under the FH, from 6 to 40 mm in front of the preaurale: P2's 'zy' id is a fixed vertex nearer the cheek). scalp: the head's points
// over the vault (above the brows, the back of the head; not the face, the ears or the temples) with their normals, for the vault fit.
export function livingAnchors(P, ids, fr, globes = null, o = {}) {
  const L = k => fr.lm(k), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), nb = o.nb ?? 13380;
  const Q = []; for (let v = 0; v < nb; v++) Q.push(fr.toMm([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]));
  const pra = Math.max(L('pra_L')[2], L('pra_R')[2]); let zyL = 0, zyR = 0;
  for (const q of Q) { if (q[1] < -15 || q[1] > 8 || q[2] < pra + 6 || q[2] > pra + 40) continue; if (q[0] > zyL) zyL = q[0]; if (-q[0] > zyR) zyR = -q[0]; }
  const out = { gop: d(L('g'), L('op')), eueu: d(L('eu_L'), L('eu_R')), zyzy: zyL + zyR, zyP2: d(L('zy_L'), L('zy_R')), nme: d(L('n'), L('me')), tt: d(L('t_L'), L('t_R')), tv: L('v')[1] - 0.5 * (L('t_L')[1] + L('t_R')[1]),
    op: L('op'), g: L('g'), n: L('n'), me: L('me'), v: L('v'), meY: L('me')[1], pg: L('pg'), gn: L('gn') };
  // the scalp points (mm) and their outward normals (from the mesh, if triangles are given)
  if (o.tri) { const N = new Float64Array(nb * 3), T = o.tri;
    for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2]; if (a >= nb || b >= nb || c >= nb) continue; const A = Q[a], B = Q[b], C = Q[c], n = cross(sub(B, A), sub(C, A)); for (const v of [a, b, c]) { N[v * 3] += n[0]; N[v * 3 + 1] += n[1]; N[v * 3 + 2] += n[2]; } }
    const nY = L('n')[1], nZ = L('n')[2], scalp = [];
    for (let v = 0; v < nb; v++) { const q = Q[v]; if (q[1] < -10) continue; const face = q[2] > nZ - 30 && q[1] < nY + 40, ear = Math.abs(q[0]) > 48 && q[1] < 40 && q[2] > -40 && q[2] < 30, temple = Math.abs(q[0]) > 40 && q[1] < 75 && q[2] > -25 && q[2] < nZ - 10;
      if (face || ear || temple) continue; const n = nrm([N[v * 3], N[v * 3 + 1], N[v * 3 + 2]]); if (dot(n, nrm(q)) < 0.3) continue; scalp.push([...q, ...n]); }
    out.scalp = scalp; }
  if (globes) { const cL = fr.toMm(globes.L.c), cR = fr.toMm(globes.R.c); out.ipd = d(cL, cR); out.globe = { L: cL, R: cR, r: 1000 * 0.5 * (globes.L.R + globes.R.R) };
    // the corneal apex: the front-most vertex of each eye proxy (the proxies are larger spheres than a real globe: r ~15 mm)
    if (o.E) { const ap = {}; for (const s of ['L', 'R']) { let best = -1e9; for (const i of globes[s].ix) { const q = fr.toMm([o.E[i * 3], o.E[i * 3 + 1], o.E[i * 3 + 2]]); if (q[2] > best) best = q[2]; } ap[s] = best; }
      out.globe.apex = { L: +ap.L.toFixed(2), R: +ap.R.toFixed(2) }; out.globe.apexAhead = +(0.5 * (ap.L - cL[2] + ap.R - cR[2])).toFixed(2); } }
  for (const k of Object.keys(out)) if (typeof out[k] === 'number') out[k] = +out[k].toFixed(2);
  return out;
}
