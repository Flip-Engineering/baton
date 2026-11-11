// TISSUE9-FACE / BAKE: the face for ANY person from their record, as one function, keyed (16 Oct 2026, round 8 iteration 1).
// The face at the hook (face9's: the person's hm08 head before face9) -> the skull (the person's own draw) -> the head and neck GROWN as
// tissue (head.js) -> the skin's outer surface -> hm08 projected onto it (project.js) -> the displacement of hm08's head vertices in bind
// space + the eyes' seat, in face9's byte format (face/face9.js parseFace9 reads it: Uint32 n, Uint16 ids[n] (pad 4), Int16 d[n*3] at
// 1e-5 m, then 'EYE1' + Float32 x 12). face/face9.js builds it on demand in node when the key has no bake (f9.t9).
//   const r = await solveFaceT9(V, deps, o)   // V { P (bind m, >= nb*3), E, info, key, seedKey, tri, side }; deps { F, globes }
//                                             // -> { buf, n, meta, ms, Hd (when o.keep) }
import { buildHeadTissue, skullOf, boneField, HEAD9_VERSION } from './head.js';
import { projectHead, globeSeat, PROJECT_VERSION } from './project.js';
import { GROW_VERSION } from './grow.js';
import { DATA_VERSION } from './data.js';
import { SKULL_VERSION } from '../../skull/skull.js';
import { NOSE_VERSION } from '../../head/nose/index.js';
import { MOUTH_VERSION } from '../../head/mouth/index.js';
export const BAKE_T9_VERSION = 1;
// the code the key carries (face/face9.js T9_CODE must equal it)
export const t9Code = () => `t9h${HEAD9_VERSION}.gr${GROW_VERSION}.da${DATA_VERSION}.pj${PROJECT_VERSION}.bk${BAKE_T9_VERSION}.sk${SKULL_VERSION}.no${NOSE_VERSION}.mo${MOUTH_VERSION}`;
export async function solveFaceT9(V, deps, o = {}) {
  const t0 = Date.now(), nb = o.nb ?? 13380, S0 = o.skull || skullOf(V, deps), G = o.G || boneField(S0.B), { fr, B, A } = S0;
  const Hd = buildHeadTissue(V, deps, { skull: S0, G, log: o.log, ...(o.head || {}) });
  const P = new Float64Array(nb * 3); for (let v = 0; v < nb; v++) P.set(fr.toMm([V.P[v * 3], V.P[v * 3 + 1], V.P[v * 3 + 2]]), v * 3);
  const proxy = { L: { c: B.globeProxy.L.c, r: B.globeProxy.L.r }, R: { c: B.globeProxy.R.c, r: B.globeProxy.R.r } };
  const Rp = projectHead(P, V.tri, nb, Hd, { ids: deps.F.ids, lid: deps.F.lid, proxy, ...(o.project || {}) });
  const Pb = new Float32Array(V.P), moved = []; for (let v = 0; v < nb; v++) { const ux = Rp.U[v * 3], uy = Rp.U[v * 3 + 1], uz = Rp.U[v * 3 + 2]; if (Math.hypot(ux, uy, uz) < 0.005) continue; const b = fr.toBind([P[v * 3] + ux, P[v * 3 + 1] + uy, P[v * 3 + 2] + uz]); Pb[v * 3] = b[0]; Pb[v * 3 + 1] = b[1]; Pb[v * 3 + 2] = b[2]; moved.push(v); }
  const seat = globeSeat(B, A?.globe?.apex || null), o0 = fr.toBind([0, 0, 0]), bindOf = d => fr.toBind(d).map((x, a) => x - o0[a]);
  const eyes = { L: { c: fr.toBind(proxy.L.c), d: bindOf(seat.L) }, R: { c: fr.toBind(proxy.R.c), d: bindOf(seat.R) } };
  const buf = encode(V.P, Pb, moved, eyes);
  const meta = { version: 1, kind: 'TISSUE9-FACE: the face grown as tissue on the person\'s skull, hm08 projected onto its skin (bind space displacement, Int16 at 1e-5 m) at the face hook, keyed by the face (face9KeyWith(.., T9_CODE))',
    key: V.key, code: t9Code(), info: V.info, n: moved.length, scale: 1e-5, seed: 'f9:' + V.seedKey, made: new Date().toISOString(), credit: 'our parametric anatomy; checked against HSRD-100 heads (Digital Reality Lab, CC BY 4.0), measurement only',
    head: { ms: Hd.report.ms, domain: Hd.report.domain, volumes: Object.fromEntries(Object.entries(Hd.report.grow.volumes).map(([k, v]) => [k, v.err])) }, project: Rp.report, globeSeat: { L: seat.L.map(x => +x.toFixed(2)), R: seat.R.map(x => +x.toFixed(2)) }, ms: Date.now() - t0, ...(o.meta || {}) };
  return { buf, n: moved.length, meta, ms: Date.now() - t0, ...(o.keep ? { Hd, P, U: Rp.U, S0, Rp } : {}) };
}
function encode(P0, Pb, moved, eyes) {
  const n = moved.length, pad = (n * 2 + 3) & ~3, buf = new Uint8Array(4 + pad + n * 6 + 52), dv = new DataView(buf.buffer);
  dv.setUint32(0, n, true); moved.forEach((v, i) => dv.setUint16(4 + i * 2, v, true));
  moved.forEach((v, i) => { for (let a = 0; a < 3; a++) dv.setInt16(4 + pad + (i * 3 + a) * 2, Math.max(-32767, Math.min(32767, Math.round((Pb[v * 3 + a] - P0[v * 3 + a]) * 1e5))), true); });
  const o = 4 + pad + n * 6; dv.setUint32(o, 0x31455945, true); [...eyes.L.c, ...eyes.L.d, ...eyes.R.c, ...eyes.R.d].forEach((x, k) => dv.setFloat32(o + 4 + k * 4, x, true));
  return buf;
}
