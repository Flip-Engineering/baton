// MOTION / CLIP FORMAT (MOTION studio, cycle 1): a compact motion take for people.js bodies (~5 KB per second at 30 fps).
// One file per take (.mot): 'MOT1', u32 header length, a JSON header, then per frame 21 local bone quaternions as int16 (x32767,
// sign-continuous), the root (hips) position in mm as int16 (x, y, z), and one byte of contacts per frame (bit 0 left foot,
// bit 1 right foot, bit 2 left hand, bit 3 right hand). The header carries the source, its licence, tags (Gilbreth's therbligs and
// the act), the measured load if any, the natural speed and step, and phase marks.
//
//   const clip = parseMotion(arrayBuffer)  |  await loadMotion(url)
//   clip.sample(t, { loop }, out) -> { q: Quaternion[21], root: Vector3 (m) }     (the bvh.js Clip interface: people.js act 'clip' plays it)
//   clip.contact(t) -> bits; clip.meta (the header)
//   encodeMotion(meta, frames) -> ArrayBuffer   frames: [{ q: [21 x [x,y,z,w]], root: [x,y,z] m, c: bits }]
import * as THREE from 'three';

export function encodeMotion(meta, frames) {
  const NB = 21, nf = frames.length, hdr = new TextEncoder().encode(JSON.stringify({ ...meta, nf, nb: NB, v: 1 }));
  const pad = (4 + 4 + hdr.length) % 2, qBytes = nf * (NB * 4 + 3) * 2, buf = new ArrayBuffer(8 + hdr.length + pad + qBytes + nf), dv = new DataView(buf);
  new Uint8Array(buf, 0, 4).set([77, 79, 84, 49]); dv.setUint32(4, hdr.length, true); new Uint8Array(buf, 8, hdr.length).set(hdr);
  const o = 8 + hdr.length + pad, I = new Int16Array(buf, o, nf * (NB * 4 + 3)), C = new Uint8Array(buf, o + qBytes, nf);
  const prev = Array.from({ length: NB }, () => [0, 0, 0, 1]);
  frames.forEach((f, i) => { const b0 = i * (NB * 4 + 3);
    for (let b = 0; b < NB; b++) { let q = f.q[b]; const dot = q[0] * prev[b][0] + q[1] * prev[b][1] + q[2] * prev[b][2] + q[3] * prev[b][3]; if (dot < 0) q = q.map(x => -x); prev[b] = q;
      for (let k = 0; k < 4; k++) I[b0 + b * 4 + k] = Math.round(Math.max(-1, Math.min(1, q[k])) * 32767); }
    for (let k = 0; k < 3; k++) I[b0 + NB * 4 + k] = Math.round(Math.max(-32.7, Math.min(32.7, f.root[k])) * 1000);
    C[i] = f.c | 0; });
  return buf;
}
export class MotionClip {
  constructor(meta, I, C) { this.meta = meta; this.I = I; this.C = C; this.nf = meta.nf; this.fps = meta.fps || 30; this.duration = (this.nf - 1) / this.fps; this.n = 21; this._a = new THREE.Quaternion(); this._b = new THREE.Quaternion(); }
  _q(i, b, out) { const k = i * (21 * 4 + 3) + b * 4, s = 1 / 32767; return out.set(this.I[k] * s, this.I[k + 1] * s, this.I[k + 2] * s, this.I[k + 3] * s).normalize(); }
  _r(i, out) { const k = i * (21 * 4 + 3) + 84; return out.set(this.I[k] / 1000, this.I[k + 1] / 1000, this.I[k + 2] / 1000); }
  sample(t, { loop = false, twos = false, fps = 30 } = {}, out = null) {
    out = out || { q: Array.from({ length: 21 }, () => new THREE.Quaternion()), root: new THREE.Vector3() };
    if (twos) t = Math.floor(t * fps / 2) * 2 / fps;
    const D = this.duration; let tt = loop ? ((t % D) + D) % D : Math.max(0, Math.min(D, t));
    const x = tt * this.fps, i = Math.min(this.nf - 1, Math.floor(x)), i2 = Math.min(this.nf - 1, i + 1), w = x - i;
    for (let b = 0; b < 21; b++) out.q[b].copy(this._q(i, b, this._a)).slerp(this._q(i2, b, this._b), w);
    const r0 = this._r(i, new THREE.Vector3()), r1 = this._r(i2, new THREE.Vector3()); out.root.copy(r0.lerp(r1, w));
    if (loop && this.meta.disp) { const c = Math.floor(t / D); out.root.x += c * this.meta.disp[0]; out.root.z += c * this.meta.disp[2]; }
    return out;
  }
  contact(t) { const i = Math.max(0, Math.min(this.nf - 1, Math.round(t * this.fps))); return this.C[i]; }
}
export function parseMotion(buf) {
  const dv = new DataView(buf), m = new Uint8Array(buf, 0, 4); if (String.fromCharCode(...m) !== 'MOT1') throw new Error('not a MOT1 file');
  const hl = dv.getUint32(4, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))), pad = (8 + hl) % 2, o = 8 + hl + pad, n = meta.nf * (21 * 4 + 3);
  return new MotionClip(meta, new Int16Array(buf.slice(o, o + n * 2)), new Uint8Array(buf, o + n * 2, meta.nf));
}
export async function loadMotion(url) { const r = await fetch(url); if (!r.ok) throw new Error('motion: ' + url + ' ' + r.status); return parseMotion(await r.arrayBuffer()); }
