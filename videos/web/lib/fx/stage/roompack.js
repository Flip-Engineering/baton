// STAGE / roompack (CAMERA7 c4): a room's triangles as the file Cycles reads (videos/blender/stage_scene.py build_room): JSON with the typed arrays in base64 (little-endian float32 / uint32).
// Pure JS; node (camera7_export.mjs) or a page. The engine does not read it (it builds the same room from room.js).
const b64 = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); if (typeof Buffer !== 'undefined') return Buffer.from(u).toString('base64'); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
export function packRoom(R) {
  const g = G => ({ n: G.p.length / 3, t: G.i.length / 3, p: b64(G.p), c: b64(G.c), i: b64(G.i) });
  return { format: 'room7 v1: three frame, metres; the wall is the plane z = -back; p/c float32 xyz/rgb (linear albedo), i uint32 triangles', seed: R.seed, back: R.back, x0: R.x0, w: R.w, h: R.h, seat: R.seat, items: R.items, flat: g(R.flat), smooth: g(R.smooth) };
}
