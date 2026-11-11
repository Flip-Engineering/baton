// MOTION c3 / BAKE7: one clip of one person baked to a MOT4 track, in node AND IN THE PAGE (labs/human8/motion6_bake.mjs's loop moved into a module, with MOTION c3's
// face channels and rulers added). NEW FILE, opt-in. Why a module: on 8 Oct the box refused to run node on this code (the client's 'STOP USING THE CPU FOR RENDERING'),
// so lab_motion7.js bakes each plate's clip on the farm's Chromium and plays it with the unchanged TrackPlayer / HairPlayer / EyePlayer; motion7_bake.mjs (node) uses
// the same function to write assets/person/motion7/<clip>/<name>.mot4 for the integrator.
//
//   const { T, buf, rep, act } = await bakeTrack7(P, () => actFor7(clip, P, name), { clip, name, fps, nf, key: 1, every: 2, cloth: true, hair: true, rulers: true })
//     P: a built person (makePerson / buildPerson), at its stance, CORRECT5 (if any) already applied. The function calls cloth.rest() FIRST (the person at its stance), THEN
//     makeAct() (the acts only pose inside frame(); their constructors leave the stance), calibrates the lids and bakes. T = decodeTrack(buf): what TrackPlayer plays;
//     rep = costs and rulers (angles per frame, the hands on the box per `every` frames, the face arcs). The garments are put back to their bind shape at the end.
// The pose of every frame is the act's (a pure function of t); the cloth is MOTION c1's spring + contact layers over the skinned garments of the person as built, relaxed as cloth (cloth_motion.js); it is KEYED EVERY FRAME (key: 1:
// the sleeve's corrections are centimetres at the armhole and the elbow's crook and change with the forearm's swing; at one key in three the player interpolated between corrections made for two other poses, 2.5 keys to a 2 Hz wave). There are NO pose keys: CLOTH's pose5 keys were made for
// the 8 Oct wave's raised pose and went stale the day the posture changed (the sleeves tore); they and the bake they lived on are deleted (15 Oct). The garment over the posed arm is CLOTH9's / CLOTHINT's to solve.
import { ClothMotion, HairSway, HAIR_CHANS, encodeTrack, decodeTrack, skinMesh } from './cloth_motion.js';
import { calibrateLids } from './life.js';
import { angles7, FACE7 } from './act7.js';

export const CH7 = ['eyeYaw', 'eyePitch', 'smile', 'blink', 'breath', 'weight', 'boxX', 'boxY', 'boxZ', 'boxYaw', 's3x', 's3z', 's2x', 's2z', ...HAIR_CHANS, ...FACE7];
const errOf = e => String((e && e.message) || e).slice(0, 160);

// P: the person; makeAct: () => act (called after cloth.rest(): the cloth's rest pose is the stance, as in the node bake)
export async function bakeTrack7(P, makeAct, { clip, name, fps = 15, nf = 91, key = 1, every = 2, cloth: wantCloth = true, hair: wantHair = true, rulers = true, popts = null, clothOpts = {} } = {}) {
  const h = P.h; h.update(); const rep = { clip, name, fps, nf, cloth: null, ms: {}, hands: [], angles: [], arc: {} }, t00 = Date.now();
  // the cloth layers (opt-out: a bust plate does not need them); a failure here leaves the garments skinned and says so
  let cloth = null; if (wantCloth) { try { cloth = new ClothMotion(P, clothOpts); cloth.rest(); rep.cloth = 'live'; } catch (e) { cloth = null; rep.cloth = 'skinned(' + errOf(e) + ')'; } } else rep.cloth = 'off';
  rep.ms.rest = Date.now() - t00;
  const act = makeAct(); const life = act.L || act.life?.L || act.life; let lids = null;
  if (life) { try { calibrateLids(h, life.rig, m => skinMesh(m)); lids = Object.fromEntries(['L', 'R'].map(s => [s, life.rig[s] && { close: life.rig[s].close, sign: life.rig[s].sign }])); } catch (e) { lids = { err: errOf(e) }; } }
  const hs = wantHair && P.groom ? new HairSway(h) : null, dt = 1 / fps, frames = [], offs = cloth ? cloth.st.map(() => []) : [];
  for (let i = 0; i < nf; i++) { const t = i * dt;
    const r = act.frame(t); h.update();
    if (rulers) { if (i % 1 === 0) { const a = angles7(h); rep.angles.push({ i, t: +t.toFixed(3), phase: r.phase, ...a }); }
      if (r.M && act.contact && i % every === 0) { try { rep.hands.push({ i, t: +t.toFixed(3), phase: r.phase, grip: r.grip, ...act.contact(r.M) }); } catch (e) { rep.handErr = errOf(e); } } }
    const f = { q: h.bones.map(B => B.quaternion.toArray()), root: h.bone('root').position.toArray(), g: r.g, c: { ...r.c, s3x: h.bone('spine03').scale.x, s3z: h.bone('spine03').scale.z, s2x: h.bone('spine02').scale.x, s2z: h.bone('spine02').scale.z } };
    if (hs) Object.assign(f.c, hs.step(dt));
    if (cloth) { cloth.step(dt, { first: i === 0, measure: false });
      if (i % key === 0) cloth.st.forEach((s, k) => { const o = Float32Array.from(s.off);
        offs[k].push(o); }); }
    frames.push(f);
  }
  rep.ms.frames = Date.now() - t00 - rep.ms.rest;
  // the bones that move (the rest are written once in the header as the clip's first frame)
  const nb = h.bones.length, moving = []; for (let b = 0; b < nb; b++) { const q0 = frames[0].q[b]; if (frames.some(f => Math.abs(f.q[b][0] - q0[0]) + Math.abs(f.q[b][1] - q0[1]) + Math.abs(f.q[b][2] - q0[2]) + Math.abs(f.q[b][3] - q0[3]) > 2e-4)) moving.push(b); }
  const still = h.bones.map((B, b) => moving.includes(b) ? null : frames[0].q[b].map(x => +x.toFixed(6)));
  // cloth: the vertices that move by > 0.6 mm in any keyframe; int8 at q m a unit
  const parts = cloth ? cloth.st.map((s, k) => { const K = offs[k], n = s.n, act2 = []; let mx = 0;
    for (let v = 0; v < n; v++) { let m = 0; for (const o of K) m = Math.max(m, Math.abs(o[v * 3]), Math.abs(o[v * 3 + 1]), Math.abs(o[v * 3 + 2])); if (m > 0.001) { act2.push(v); mx = Math.max(mx, m); } }
    const q = Math.max(0.0005, mx / 127), data = new Int8Array(K.length * act2.length * 3);
    K.forEach((o, j) => act2.forEach((v, a) => { for (let c = 0; c < 3; c++) data[(j * act2.length + a) * 3 + c] = Math.round(Math.max(-127, Math.min(127, o[v * 3 + c] / q))); }));
    return { name: s.m.userData.k3.name, n, active: act2, q, data }; }) : [];
  // the face channels' arc: the range of each over the clip (small, never a grin)
  for (const c of ['smile', 'brow', 'squint', 'platysma']) { const v = frames.map(f => f.c[c] ?? 0); rep.arc[c] = { min: +Math.min(...v).toFixed(3), max: +Math.max(...v).toFixed(3) }; }
  const meta = { clip, name, fps, bones: moving, still, chans: CH7, lids, act: act.rep || null, person: { label: P.info?.label, sex: P.info?.sex, age: P.info?.age, height: h.o.height }, study: false, popts: popts || null,
    credit: P.report?.credit || null, src: 'MOTION c3 (lib/fx/motion/act7.js on act6.js, life.js, cloth_motion.js; lane F HandRig); our own motion, no outside material' };
  const buf = encodeTrack(meta, frames, cloth ? { key, parts } : null);
  rep.bytes = buf.byteLength; rep.act = act.rep || null; rep.ms.total = Date.now() - t00;
  return { T: decodeTrack(buf), buf, rep, act };
}
