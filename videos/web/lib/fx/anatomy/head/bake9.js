// ANAT8-HEAD (c7 it17, 15 Oct): FACE REV 9's BAKE AS ONE FUNCTION, so the person build can make it for ANY person whose key has no bake.
// Until it16 the construction lived only in the lab script labs/human8/anat8/anat8_f9.mjs, run by hand over the twelve; a person the
// system had never seen (a CAST-sampled worker, a crowd member, a reseeded face) rendered without face9. Now:
//   face/face9.js face9Apply: key missing + running in node -> solveFace9 (this file) -> encodeFace9 -> written to the keyed cache
//   (assets/person/anat8h/cache/<key>.bin .json) -> applied. The page (no fs, no time to solve) still only reads the cache.
//   labs/human8/anat8/anat8_f9.mjs (the measuring build step) calls the SAME layers9 / membrane9, so the build step and the on-demand
//   path cannot drift apart.
// THE BAKE DEPENDS ONLY ON THE KEY'S INPUTS: the face at the hook, sex / age / ancestry / BMI and the code. Until it16 the skull's random
// residual (drawSkull's rng) and NOSEMOUTH's framework were seeded by the person's NAME, which the key does not carry (two people with one
// face would have got two skulls under one key, and an unnamed person a third). The seed is now the face's key itself ('f9:<key>'): the
// residual is a property of the face, the same in the page, the build step and the on-demand build.
// Pure JS apart from the anatomy modules (no three.js, no fs); millimetres in the craniometric frame (skull/frame.js).
//   const L9 = await layers9(V, deps, o)      // V { P (bind, metres, Float32Array: at least the head), E (eyes), info, key, seedKey, tri, side }
//                                             // deps { F (the face studio: ids, pop.tissue, lid), globes (face6.js globes) }
//   const M9 = membrane9(V, L9, deps, mopts)  // { fit, P (mm), P0 (mm: P + the eyes' carry), P9 (mm), Pb (bind), moved, seat, eyes, Eb }
//   const buf = encodeFace9(V.P, M9)          // Uint8Array: Uint32 n, Uint16 ids[n] (pad 4), Int16 d[n*3] at 1e-5 m, then (rev 3) the eyes'
//                                             // move: Uint32 0x31455945 ('EYE1'), Float32 x 12 (bind m: the cast eye's centre L, its move L,
//                                             // the centre R, the move R) (face9.js reads it)
//   const r = await solveFace9(V, deps, o)    // all three; { buf, n, meta, ms }
import * as FR from '../skull/frame.js';
import * as SK from '../skull/skull.js';
import * as HD from './index.js';
import * as MB from './membrane.js';
import * as FILL from './fill.js';
import * as SOFT from './soft.js';
import { FAT_VERSION } from './fat.js';
import { MUSCLES_VERSION } from './muscles.js';
import { NOSE_VERSION } from './nose/index.js';
import { LAYER_VERSION } from '../layer/index.js';
export const BAKE9_VERSION = 3;   // (lane it22) THE EYES FOLLOW THE BONE: the globes seated by the orbit, the eyes' soft tissue carried (membrane.js globeSeat / globeCarry), the eyes' move written after the displacement (encodeFace9: the 'EYE1' block); (lane it20) the seed from the face WITHOUT the code (V.seedKey: face9.js face9SeedKey); 1 (c7 it17): the seed from the face's key, not the name
// the anatomy code's versions as one string: face/face9.js ANAT8_CODE must equal it (the key carries it; a mismatch = stale bakes)
export const anat8Code = () => `sk${SK.SKULL_VERSION}.hd${HD.HEAD_VERSION}.mb${MB.MEMBRANE_VERSION}.so${SOFT.FACE_SOFT_VERSION}.ft${FAT_VERSION}.mu${MUSCLES_VERSION}.fi${FILL.FILL_VERSION}.ly${LAYER_VERSION}.no${NOSE_VERSION}.bk${BAKE9_VERSION}`;
// the seed's name: what the face is (its key), never who the person is
export const seedName = key => 'f9:' + key;
// (lane it20) THE SEED IS THE FACE'S, NOT THE CODE'S. Until it19 the seed was the bake's key, and the key carries ANAT8_CODE, so every change
// of any anatomy module re-drew every skull's random residual: L20's skull came 6.8 mm further forward at the glabella under the next code
// (the it20 trial bake), and an A/B of a fill change would have shown a different skull. The seed key (face9.js face9SeedKey: the face and the
// person's record under a FROZEN code string, the it17-it19 one, so the faces the critic has seen keep their skulls) is stable across code
// versions; the bake still depends only on the key's inputs.

// THE LAYERS: frame -> skull -> head (bone, cartilage, deep fat, muscles, superficial fat) -> the offset envelope -> the fill -> the soft solve
// o: { nb, sigma, head {}, fill {} | false, soft {} | false, softLog }
export function layers9(V, deps, o = {}) {
  const { F, globes } = deps, nb = o.nb ?? 13380, info = V.info, st = { sex: info.sex, age: info.age, bmi: info.bmi }, t0 = Date.now();
  const I = F.ids, G6 = globes(V.E, V.side), fr = FR.headFrameFH(V.P, I, { sex: info.sex, globes: G6 }), A = FR.livingAnchors(V.P, I, fr, G6, { tri: V.tri, E: V.E });
  const sinfo = { ...info, name: seedName(V.seedKey ?? V.key) };
  const K = SK.drawSkull(sinfo, A, { T: F.pop.tissue }), B = SK.buildSkull(K), cast = Object.fromEntries(['ch_L', 'al_L', 'prn', 'sn', 'sto'].map(k => [k, fr.lm(k)]));
  const Hh = HD.buildHead(B, { ...st, fitness: 0.5 }, { T: F.pop.tissue, cast, ...(o.head || {}) }), t1 = Date.now();
  const envO = MB.skinEnvelope(Hh, B, { sigma: o.sigma ?? 1.6 });   // the OFFSET skin: which deep surface lies under the skin
  // the superficial fat FILLS under a tensioned skin (head/fill.js); o.fill === false: the offset (node A/B only)
  let env0 = envO, fl = null; if (o.fill !== false) { fl = FILL.fillEnvelope(Hh, B, st, { E0: envO.E, ...(o.fill || {}) });
    env0 = { E: fl.E, box: fl.box, report: { ...envO.report, fill: fl.report.fill, ms: { sample: envO.report.ms.sample, clean: envO.report.ms.clean, fill: fl.report.ms } } }; }
  // the soft tissue SOLVED under gravity in the upright pose (the bind's -y in the craniometric frame); o.soft === false: unloaded (A/B)
  const grav = [-9.81 * fr.X[1], -9.81 * fr.Y[1], -9.81 * fr.Z[1]];
  const sol = o.soft === false ? null : SOFT.solveFaceTissue(Hh, B, env0, st, { gravity: grav, ...(o.soft || {}), log: o.softLog || null });
  const env = sol ? { E: sol.E, box: env0.box, report: { ...env0.report, solved: sol.report } } : env0, t2 = Date.now();
  return { fr, A, K, B, Hh, envO, env0, env, fl, sol, ms: { head: t1 - t0, envelope: t2 - t1 } };
}

// THE MEMBRANE: hm08's head onto the solved envelope (the lids, lips' form, nostrils and ears kept); rev 9 back in bind space
// (rev 3, lane it22) THE EYES FOLLOW THE BONE: each globe moved whole to the seat the bone gives it (membrane.js globeSeat: the orbit's
// centre, the bone's corneal plane), the lids, canthi and socket carried with it (globeCarry), and the membrane fitted from there (its locks
// hold the carried lids; its proxies are the seated globes). M9.eyes: the move in bind space (the page moves the person's eyes by it);
// M9.Eb: the cast's eyes moved (bind), for the build step's measures.
export function membrane9(V, L9, deps, mopts = {}, nb = 13380) {
  const { F } = deps, { fr, B, Hh, env, A } = L9, t0 = Date.now();
  const P = new Float64Array(nb * 3); for (let v = 0; v < nb; v++) P.set(fr.toMm([V.P[v * 3], V.P[v * 3 + 1], V.P[v * 3 + 2]]), v * 3);
  const proxy0 = { L: { c: B.globeProxy.L.c, r: B.globeProxy.L.r }, R: { c: B.globeProxy.R.c, r: B.globeProxy.R.r } };
  const seat = MB.globeSeat(B, A?.globe?.apex || null), U0 = MB.globeCarry(P, nb, proxy0, seat);
  const proxy = { L: { c: proxy0.L.c.map((x, a) => x + seat.L[a]), r: proxy0.L.r }, R: { c: proxy0.R.c.map((x, a) => x + seat.R[a]), r: proxy0.R.r } };
  const P0 = new Float64Array(P); for (let i = 0; i < nb * 3; i++) P0[i] += U0[i];
  // (EYES-FIX, 16 Oct; membrane rev 8) the canthi on the canthal tendons (membrane.js canthalTendons): the carried lid-margin rings re-laid
  // between the commissures our skull's orbit gives them, before the sheet is fitted (its locks then hold them there)
  const ct = MB.canthalTendons(P0, nb, F.lid, F.ids, B, proxy), canthi = ct.report; for (let i = 0; i < nb * 3; i++) P0[i] += ct.U[i];
  const fit = MB.fitMembrane(P0, V.tri, nb, env.E, Hh, B, { lids: [F.lid?.L || [], F.lid?.R || []], proxy, ...mopts });
  const P9 = new Float64Array(P0); for (let i = 0; i < nb * 3; i++) P9[i] += fit.U[i];
  const Pb = new Float32Array(V.P), moved = []; for (let v = 0; v < nb; v++) { const m = Math.hypot(P9[v * 3] - P[v * 3], P9[v * 3 + 1] - P[v * 3 + 1], P9[v * 3 + 2] - P[v * 3 + 2]); if (m < 0.005) continue; const b = fr.toBind([P9[v * 3], P9[v * 3 + 1], P9[v * 3 + 2]]); Pb[v * 3] = b[0]; Pb[v * 3 + 1] = b[1]; Pb[v * 3 + 2] = b[2]; moved.push(v); }
  // the eyes' move in bind space, and the cast's eyes moved by it (each eye vertex goes with the nearer globe)
  const o0 = fr.toBind([0, 0, 0]), bindOf = d => fr.toBind(d).map((x, a) => x - o0[a]), eyes = { L: { c: fr.toBind(proxy0.L.c), d: bindOf(seat.L) }, R: { c: fr.toBind(proxy0.R.c), d: bindOf(seat.R) } };
  const Eb = V.E ? moveEyes(V.E, eyes) : null;
  return { fit, P, P0, P9, Pb, moved, seat: { L: seat.L.map(x => +x.toFixed(2)), R: seat.R.map(x => +x.toFixed(2)) }, eyes, Eb, canthi, ms: Date.now() - t0 };
}
// the eyes moved whole (each vertex with the nearer globe's centre); the same rule face/face9.js applies in the page
export function moveEyes(E, eyes, g = 1) { const out = new Float32Array(E), cL = eyes.L.c, cR = eyes.R.c;
  for (let i = 0; i < E.length; i += 3) { const dL = (E[i] - cL[0]) ** 2 + (E[i + 1] - cL[1]) ** 2 + (E[i + 2] - cL[2]) ** 2, dR = (E[i] - cR[0]) ** 2 + (E[i + 1] - cR[1]) ** 2 + (E[i + 2] - cR[2]) ** 2, d = (dL <= dR ? eyes.L : eyes.R).d;
    out[i] += g * d[0]; out[i + 1] += g * d[1]; out[i + 2] += g * d[2]; }
  return out; }

// the bake's bytes (little-endian, the format face9.js loadFace9 reads)
export function encodeFace9(P0, M9) {
  const { moved, Pb } = M9, n = moved.length, pad = (n * 2 + 3) & ~3, ext = M9.eyes ? 52 : 0, buf = new Uint8Array(4 + pad + n * 6 + ext), dv = new DataView(buf.buffer);
  dv.setUint32(0, n, true); moved.forEach((v, i) => dv.setUint16(4 + i * 2, v, true));
  moved.forEach((v, i) => { for (let a = 0; a < 3; a++) dv.setInt16(4 + pad + (i * 3 + a) * 2, Math.max(-32767, Math.min(32767, Math.round((Pb[v * 3 + a] - P0[v * 3 + a]) * 1e5))), true); });
  if (ext) { const o = 4 + pad + n * 6; dv.setUint32(o, 0x31455945, true); [...M9.eyes.L.c, ...M9.eyes.L.d, ...M9.eyes.R.c, ...M9.eyes.R.d].forEach((x, k) => dv.setFloat32(o + 4 + k * 4, x, true)); }
  return buf;
}
export function meta9(V, L9, M9, extra = {}) {
  return { version: 2, kind: 'anat8h face rev 9 displacement (bind space, Int16 at 1e-5 m) at the face hook (face3Shape), keyed by the face (face9Key)', key: V.key, code: anat8Code(), info: V.info, n: M9.moved.length, scale: 1e-5,
    seed: seedName(V.seedKey ?? V.key), made: new Date().toISOString(), credit: 'our parametric anatomy; profile checked against HSRD-100 heads (Digital Reality Lab, CC BY 4.0), measurement only',
    solve: L9.sol ? { steps: L9.sol.report.solve.steps, converged: L9.sol.report.solve.converged } : null, ms: { ...L9.ms, membrane: M9.ms }, ...(M9.seat ? { globeSeat: M9.seat } : {}), ...extra };
}
// the whole bake for one face (the on-demand path)
export async function solveFace9(V, deps, o = {}) {
  const t0 = Date.now(), L9 = layers9(V, deps, o), M9 = membrane9(V, L9, deps, o.mopts || {}, o.nb ?? 13380);
  return { buf: encodeFace9(V.P, M9), n: M9.moved.length, meta: meta9(V, L9, M9, o.meta || {}), ms: Date.now() - t0 };
}
