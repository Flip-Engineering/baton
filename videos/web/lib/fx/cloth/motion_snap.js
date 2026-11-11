// MOTION SNAP (CLOTHINT, round 7, 8 Oct 2026): the snapshot / restore discipline of the Drape (drape_sheet.js) for MOTION's garment cloth
// (lib/fx/motion/cloth_motion.js, ClothMotion). New file, opt-in, touches nothing of MOTION's: it reads and writes the few fields ClothMotion keeps between
// frames, so a farm segment that starts mid-clip can resume a bake instead of replaying it from frame 0.
//
// What ClothMotion's state IS (read from the code, 8 Oct): per carried part s, the spring layer's displacement `d` and velocity `v` (Float32Array n*3) and the last
// two skinned frames `prevS`, `prevS2` (the acceleration that drives the lag is their second difference), plus the clock `_t`. Everything else a step reads
// is re-derived from the hero's pose and the bake's stance (`rest()`, the rest clearances, the weld lists, the freedom field) or is scratch overwritten each step
// (`S`, `A`, `wo`, `off`, the body buffers). So the discipline is: the fresh object is built the same way (new ClothMotion(P, opts); the hero in the bake's stance;
// C.rest()), then motionRestore(C, snap), then pose the hero for the next frame and C.step(dt) (without `first`). Deterministic: ClothMotion has no randomness and
// no clock; the pose is the caller's. Checked in labs/clothing2/drape_test.mjs (section 9): frames 0-23 uninterrupted vs 0-11, snapshot, a fresh ClothMotion, restore,
// 12-23: the bind offsets of every part byte-identical.
// Coupling (honest): this reads ClothMotion's field names (st[i].d, .v, .prevS, .prevS2, _t). If MOTION c3 renames them, the test says so; the change is two lines here.
export function motionSnapshot(C) {
  return { v: 1, t: C._t ?? 0, parts: C.st.map(s => ({ n: s.n, d: s.d.slice(), vel: s.v.slice(), prevS: s.prevS ? s.prevS.slice() : null, prevS2: s.prevS2 ? s.prevS2.slice() : null })) };
}
export function motionRestore(C, S) {
  if (S.parts.length !== C.st.length) throw new Error(`motionRestore: ${S.parts.length} parts in the snapshot, ${C.st.length} in this ClothMotion`);
  C.st.forEach((s, i) => { const p = S.parts[i]; if (p.n !== s.n) throw new Error(`motionRestore: part ${i} has ${p.n} vertices in the snapshot, ${s.n} here`);
    s.d.set(p.d); s.v.set(p.vel); s.prevS = p.prevS ? Float32Array.from(p.prevS) : null; s.prevS2 = p.prevS2 ? Float32Array.from(p.prevS2) : null; });
  C._t = S.t; return C;
}
// a checksum of what a step produced (the bind offsets of every part), for the test and for a farm segment to compare with the previous segment's last frame
export function motionKey(C) { let h = 2166136261; for (const s of C.st) { const o = s.off; for (let i = 0; i < o.length; i++) { h = Math.imul(h ^ Math.round(o[i] * 1e6), 16777619) >>> 0; } } return h >>> 0; }
