// CLOTH5 for MOTION: garments CARRIED into an act's KEY POSES (MOTION c1: a raised arm tore the shirt at the armpit, the squat opened the fly,
// the cuff joins and the tucked edge frilled: the v4c bake skinned far from the one stance it was carried into). The key-pose bake is the
// stance bake's own chain (same draft, same sew, same A-pose settle and skin weights), carried on into the act's pose (bake4 fix5.pose);
// here its garment and construction parts become BIND-SPACE OFFSETS from the stance bake's (same parts, same vertex counts), so the page
// blends a clip's cloth between pose-carried shapes: X_bind(t) = X_stance + sum_k w_k(t) off_k, skinned as before (MOTION's layers on top).
//   keyPoseFromTrack(T, frame)            T = cloth_motion.js decodeTrack(buf): { q: [per hero bone [x,y,z,w] | null], root }
//   poseOffsets(stance, key)              two unpacked bakes (finish.js unpackBake) -> { parts: [{ name, n, off Float32Array }], maxMm, wDiff }
//   encodePose5 / decodePose5             the file: 'POS5', u32 header length, JSON { name, clip, keys: [{ key, frame, q, root, drive }], parts: [{ name, n }] },
//                                         then per key per part n x 3 int16 (0.1 mm)
//   poseWeights(h, P5, { sigma })         the keys' weights for the hero's current pose (Gaussian in the drive bones' rotation; the stance is
//                                         key 0 with no offset): [w_1 .. w_K] summing to <= 1
//   applyPose5(meshes, X0s, P5, w)        writes X0 + sum w_k off_k into each part mesh's bind positions (needsUpdate)
export const POSE5_VERSION = 1;
export function keyPoseFromTrack(T, frame) {
  const H = T.H, nb = H.bones.length, st = nb * 4 + 3, s = 1 / 32767, q = [], f = Math.max(0, Math.min(T.nf - 1, Math.round(frame)));
  if (H.still) H.still.forEach((v, b) => { if (v) q[b] = [v[0], v[1], v[2], v[3]]; });
  for (let b = 0; b < nb; b++) { const a = f * st + b * 4; let x = T.pose[a] * s, y = T.pose[a + 1] * s, z = T.pose[a + 2] * s, w = T.pose[a + 3] * s; const l = Math.hypot(x, y, z, w) || 1; q[H.bones[b]] = [x / l, y / l, z / l, w / l]; }
  const r = f * st + nb * 4; return { q, root: [T.pose[r] / 1000, T.pose[r + 1] / 1000, T.pose[r + 2] / 1000], frame: f };
}
const isCloth = q => q.group === 'garment' || q.group === 'construction';
export function poseOffsets(A, B) {
  const pa = A.filter(isCloth), pb = B.filter(isCloth), out = []; let maxMm = 0, wDiff = 0, skipped = 0;
  for (let k = 0; k < pa.length; k++) { const a = pa[k], b = pb[k]; if (!b || a.name !== b.name || a.X.length !== b.X.length) { out.push({ name: a.name, n: a.X.length / 3, off: null }); skipped++; continue; }
    const n = a.X.length / 3, off = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) { off[i] = b.X[i] - a.X[i]; } for (let v = 0; v < n; v++) maxMm = Math.max(maxMm, Math.hypot(off[v * 3], off[v * 3 + 1], off[v * 3 + 2]) * 1000);
    for (let i = 0; i < a.SW.length; i++) wDiff = Math.max(wDiff, Math.abs(a.SW[i] - b.SW[i]) * (a.SI[i] === b.SI[i] ? 1 : 1));
    out.push({ name: a.name, n, off }); }
  return { parts: out, maxMm, wDiff, skipped };
}
export function encodePose5(meta, keys) {   // keys: [{ key, frame, q, root, drive, parts: [{ name, n, off }] }]
  const parts = keys[0].parts.map(p => ({ name: p.name, n: p.n })), hdr = new TextEncoder().encode(JSON.stringify({ v: POSE5_VERSION, ...meta, parts, keys: keys.map(k => ({ key: k.key, frame: k.frame, q: k.q, root: k.root, drive: k.drive })) }));
  const hl = hdr.length, pad = (4 - (8 + hl) % 4) % 4, tot = parts.reduce((a, p) => a + p.n * 3 * 2, 0) * keys.length, buf = new Uint8Array(8 + hl + pad + tot + 4), dv = new DataView(buf.buffer);
  buf.set([80, 79, 83, 53]); dv.setUint32(4, hl, true); buf.set(hdr, 8); let o = 8 + hl + pad;
  for (const k of keys) for (const p of k.parts) { const I = new Int16Array(p.n * 3); if (p.off) for (let i = 0; i < p.n * 3; i++) I[i] = Math.round(Math.max(-3.2767, Math.min(3.2767, p.off[i])) * 1e4); buf.set(new Uint8Array(I.buffer), o); o += I.byteLength; }
  return buf.subarray(0, o);
}
export function decodePose5(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset); if (String.fromCharCode(...u8.subarray(0, 4)) !== 'POS5') throw new Error('not a POS5 file');
  const hl = dv.getUint32(4, true), H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl))); let o = 8 + hl + (4 - (8 + hl) % 4) % 4;
  const keys = H.keys.map(k => ({ ...k, parts: H.parts.map(p => { const I = new Int16Array(u8.slice(o, o + p.n * 6).buffer); o += p.n * 6; return Float32Array.from(I, x => x * 1e-4); }) }));
  return { H, keys };
}
// the angle between two unit quaternions (rad)
const qAng = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
export function poseWeights(h, P5, { sigma = 0.35, stance = null } = {}) {
  const ks = P5.keys, d = ks.map(k => { let s = 0; for (const b of k.drive) { const B = h.bones[b], q = [B.quaternion.x, B.quaternion.y, B.quaternion.z, B.quaternion.w]; s += qAng(q, k.q[b]) ** 2; } return Math.sqrt(s / Math.max(1, k.drive.length)); });
  // the stance (key 0, no offset): its distance from the stance quaternions of the same drive bones
  let d0 = Infinity; if (stance) { let s = 0, m = 0; for (const b of ks[0].drive) { const B = h.bones[b]; if (!stance[b]) continue; s += qAng([B.quaternion.x, B.quaternion.y, B.quaternion.z, B.quaternion.w], stance[b]) ** 2; m++; } d0 = Math.sqrt(s / Math.max(1, m)); }
  const g = x => Math.exp(-(x * x) / (sigma * sigma)), w = d.map(g), w0 = isFinite(d0) ? g(d0) : Math.max(0, 1 - Math.max(...w)), sum = w.reduce((a, b) => a + b, 0) + w0;
  return w.map(x => x / (sum || 1));
}
export function applyPose5(meshes, X0s, P5, w, scale = 1) {
  meshes.forEach((m, j) => { if (!m) return; const X = m.geometry.attributes.position.array, X0 = X0s[j]; X.set(X0);
    P5.keys.forEach((k, ki) => { const off = k.parts[j]; if (!off || !w[ki] || off.length !== X.length) return; const s = w[ki] / scale; for (let i = 0; i < X.length; i++) X[i] += off[i] * s; });
    m.geometry.attributes.position.needsUpdate = true; });
}
