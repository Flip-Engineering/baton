// FACE REV 9 (ANAT8-HEAD, 8 Oct, it4): the face's FORM from the SKULL OUT. Our parametric skull (lib/fx/anatomy/skull/), the muscles,
// the fat compartments and the skin's envelope over them (lib/fx/anatomy/head/), and hm08's head moved onto that skin as a MEMBRANE
// (head/membrane.js: a smooth displacement; the lids, the lips' form, the nostrils and the ears kept), all solved OFFLINE in node per
// person (labs/human8/anat8/anat8_f9.mjs --write) into a small asset, assets/person/anat8h/cache/<key>.bin: Uint32 n, Uint16 ids[n] (padded
// to 4 bytes), Int16 d[n * 3], the displacement of hm08's head vertices in bind space in units of 0.01 mm, computed on the face at this
// hook (face3Shape's output, the same for latest: as it was for v6). (it6) The anatomy's soft tissue is SOLVED under gravity before the fit
// (anatomy/head/soft.js on ANAT8-BODY's soft/).
// The page never runs the solver: this file only reads the bake and adds it.
//   ON FOR EVERY PERSON (15 Oct, the client's 'every built system ON'; v7lanes/ANAT8_HEAD.json { face9: { gain: 1 } } and person/build.js
//   DEFAULTS): makePerson(<name>) carries it; { face9: false } only as one A/B arm. Options: f9.gain (default 1), f9.url (the bake folder).
//   Each register is its own face: the bare figure study's hook face and the dressed one's differ (BODY7's records), so each has its key.
// Where it runs (face3.js face3Data): right after face3Shape (FACE6's tissue, FACE4's lids and lips warp), BEFORE MOUTH's lip form,
// FACE5's symmetry and rest, FACE6's expression and lid seating and FACE7's lids and seal: those run on rev 9's form as they ran on
// v6's (the lips' paint lines, the mouth's occlusion and the globe's cover are read from the final shape). People without a bake are
// returned unchanged (report.missing).
// (c6 it15, FACE9_VERSION 2) ANY PERSON, NO PER-PERSON BAKE: the bake is found by WHAT THE FACE IS, not by a name. face9Key(info, P) is a
// digest of the face at this hook (64 centroids of the head's vertices, 0.2 mm; the centroids average float noise away, so the node build
// and the page agree) + the person's sex, age, ancestry and BMI + ANAT8_CODE (the anatomy code's versions). The bake lives at
// assets/person/anat8h/cache/<key>.bin and is BUILT ON DEMAND by the build step (labs/human8/anat8/anat8_f9.mjs --people <names|all>
// --write: it builds each person with makePerson in node, reads the face at this hook through spec.probe, solves and writes the key; fresh
// keys are skipped). A person whose face, anatomy code or record changed gets a new key: the old bake no longer matches (no stale bake is
// ever applied) and report.missing carries the key and the command. Any person the person system builds gets face9 the same way: nothing
// in the bake or here knows a name. (The name-keyed bakes of it4-it14 are deleted: git history only.)
// (c7 it17, FACE9_VERSION 3) BUILT IN THE PERSON BUILD: when the key has no bake and this runs in NODE (the person build: makePerson in node,
// the build step, a farm CPU step), face9Apply SOLVES the bake itself (anatomy/head/bake9.js solveFace9: the same layers and membrane the
// build step uses), writes it to the keyed cache and applies it: makePerson of a person nobody baked gets the face (6-15 min the first time,
// then a fetch). The page (no fs, no time to solve) only reads the cache and reports missing. Off: f9.build false or ANAT8_F9_BUILD=0.
// The skull's and the nose's random residual is seeded by the FACE (face9SeedKey: the key's inputs under the frozen SEED_CODE; lane it20), not
// the name and not the code: the bake depends only on the key's inputs, and a code change does not re-draw a skull.
// (lane it22, FACE9_VERSION 4) THE EYES FOLLOW THE BONE: a bake may carry the eyes' move (the 'EYE1' block after the displacement: each
// globe seated in OUR orbit, anatomy/head/membrane.js globeSeat); face9Apply returns the person's eyes moved by it (E), and face3.js hands
// them on, so FACE6's lid seating, FACE7's lids and seal, the brows, lashes and the engine eye all read the seated globe.
export const FACE9_VERSION = 4;
// the anatomy code the bake was solved with (skull, head layers, membrane, soft solve, fat, muscles, fill, layer core, nose framework); the
// builder refuses to write when these differ from the modules' own constants (bump here with the module)
export const ANAT8_CODE = 'sk5.hd8.mb8.so1.ft5.mu5.fi3.ly3.no3.bk3';   // (lane it25, 16 Oct) .mb8 = head/membrane.js rev 8 (EYES-FIX: the canthi on the canthal tendons, the lid-margin rings' ends from our skull's orbit), .ft5 = head/fat.js rev 5 (the middle cheek reaching back to the parotid's anterior border), .mu5 = head/muscles.js rev 5 (the masseter's anterior part a sheet from the arch to its insertion), .no3 = NOSEMOUTH's nose/index.js rev 3 (the columella's base on the upper lip's sheet: softAnchors' tip moves with it); the twelve baked 13:05-17:0x (anat8_head/measures/f9_it25_*.log); (orchestrator 16 Oct) .hd8 = head/index.js rev 8 (solveAmounts' bound 2 -> 5), .ft4 = head/fat.js rev 4 (the jowl on the mandible's body to the masseter's border and the middle cheek down to it: the lower face's T-Table sites had no compartment over them; the twelve baked 09:05-10:00, anat8_head/measures/f9_orch_*.log); (lane it23) .hd7 = head/index.js rev 7 (the sites on the 2023 T-Table's landmarks, head/depths.js; the superficial compartments' AMOUNTS solved from it), .fi3 = fill.js rev 3 (the fat holds its thickness under a tensioned, bending skin); (lane it22) .sk5 = skull.js rev 5 (the corneal apex drawn against the nasion), .mb7 = membrane.js rev 7 (the eyes seated by the bone, their soft tissue carried), .bk3 = bake9.js rev 3 (the eyes' move in the bake: the EYE1 block); (lane it21) .mb6 = head/membrane.js rev 6 (the skin's stiffness in millimetres, the data weight uniform); (lane it20) .fi2 = head/fill.js rev 2 (the fat on the skin, at its grown equilibrium), .bk2 = the seed by the face (SEED_CODE); (c7 it17) .bk = anatomy/head/bake9.js BAKE9_VERSION
// (lane it20) the skull's and the nose's random residual: seeded by the face under this FROZEN code (the it17-it19 one), never the current
// code, so a change to any anatomy module does not re-draw anyone's skull (bake9.js seedName, V.seedKey)
// (TISSUE9-FACE, round 8 it1, 16 Oct) THE FACE GROWN AS TISSUE: f9.t9 (opt-in until the critic reads it better than rev 9) keys the bake by
// T9_CODE instead of ANAT8_CODE, reads it from assets/person/tissue9face/cache/ and, when missing in node, builds it with
// lib/fx/anatomy/tissue9/face/bake.js solveFaceT9 (the head and neck grown on the person's skull, hm08 projected onto the skin). The bytes
// are face9's (the same apply). Must equal bake.js t9Code().
export const T9_CODE = 't9h1.gr1.da1.pj1.bk1.sk5.no3.mo3';
export const SEED_CODE = 'sk4.hd6.mb5.so1.ft3.mu4.fi1.ly3.no2.bk1';
const cache = new Map();
const BASE = () => new URL('../../../assets/person/anat8h/cache/', import.meta.url).href, BASE_T9 = () => new URL('../../../assets/person/tissue9face/cache/', import.meta.url).href;
export function face9Spec(info, o = {}) { const f9 = typeof o.f9 === 'object' && o.f9 ? o.f9 : {};
  return { v: FACE9_VERSION, info: { sex: info.sex, age: info.age ?? null, group: info.group ?? null, bmi: info.bmi ?? null }, gain: f9.gain ?? 1, ...(f9.url ? { url: f9.url } : {}), ...(typeof f9.probe === 'function' ? { probe: f9.probe } : {}), ...(f9.build === false ? { build: false } : {}), ...(f9.t9 ? { t9: true } : {}) }; }
// FNV-1a over a string, two lanes -> 16 hex
function fnv(s) { let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x01000193 + 2 * 0x100) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'); }
// the face's digest at the hook: 64 contiguous index blocks of the head's vertices [0, nb), each block's centroid in units of 0.2 mm
export function faceDigest(P, nb = 13380, k = 64) { const out = []; const step = Math.ceil(nb / k);
  for (let b = 0; b < k; b++) { const v0 = b * step, v1 = Math.min(nb, v0 + step); let x = 0, y = 0, z = 0, n = 0; for (let v = v0; v < v1; v++) { x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; n++; }
    if (n) out.push(Math.round(x / n * 5000), Math.round(y / n * 5000), Math.round(z / n * 5000)); }
  return out; }
export function face9Key(info, P, nb = 13380) { return face9KeyWith(info, P, ANAT8_CODE, nb); }
// (lane it20) the key under a given anatomy code: the build step bakes the NEXT code's keys (anat8_f9.mjs --next-code) before ANAT8_CODE is
// bumped, so no person is ever without a bake while the twelve are rebuilt
export const face9SeedKey = (info, P, nb = 13380) => face9KeyWith(info, P, SEED_CODE, nb);
export function face9KeyWith(info, P, code, nb = 13380) { const i = info || {}, rec = [i.sex, i.age == null ? '' : Math.round(i.age), i.group || '', i.bmi == null ? '' : (+i.bmi).toFixed(1), code].join('|');
  return fnv(rec + '#' + faceDigest(P, nb).join(',')); }
export async function loadFace9(key, url = null) {
  const base = url || BASE(), k = base + key;
  if (cache.has(k)) return cache.get(k);
  const p = (async () => { try { const r = await fetch(new URL(key + '.bin', base)); if (!r.ok) return null; return parseFace9(await r.arrayBuffer()); } catch { return null; } })();
  cache.set(k, p); return p;
}
// the bake's bytes -> { n, ids, d, scale, eyes? } (eyes: { L: { c, d }, R } in bind metres, the cast eye's centre and its move)
export function parseFace9(buf) { const dv = new DataView(buf), n = dv.getUint32(0, true), pad = (n * 2 + 3) & ~3, o = 4 + pad + n * 6, out = { n, ids: new Uint16Array(buf, 4, n), d: new Int16Array(buf, 4 + pad, n * 3), scale: 1e-5 };
  if (buf.byteLength >= o + 52 && dv.getUint32(o, true) === 0x31455945) { const f = k => dv.getFloat32(o + 4 + k * 4, true), v = k => [f(k), f(k + 1), f(k + 2)]; out.eyes = { L: { c: v(0), d: v(3) }, R: { c: v(6), d: v(9) } }; }
  return out; }
// the eyes moved whole by the bake's seat (each eye vertex with the nearer globe), at gain g (anatomy/head/bake9.js moveEyes: the same rule)
export function moveEyes9(E, eyes, g = 1) { const out = new Float32Array(E), cL = eyes.L.c, cR = eyes.R.c;
  for (let i = 0; i < E.length; i += 3) { const dL = (E[i] - cL[0]) ** 2 + (E[i + 1] - cL[1]) ** 2 + (E[i + 2] - cL[2]) ** 2, dR = (E[i] - cR[0]) ** 2 + (E[i + 1] - cR[1]) ** 2 + (E[i + 2] - cR[2]) ** 2, d = (dL <= dR ? eyes.L : eyes.R).d;
    out[i] += g * d[0]; out[i + 1] += g * d[1]; out[i + 2] += g * d[2]; }
  return out; }
// P: the face's positions (bind, metres; Float32Array), at least the body's vertices; returns a new array with the bake added.
// spec.probe (node builder only): called with the face at the hook, its eyes and its key before anything is applied
export async function face9Apply(F, P, eyes, spec, ctx = {}) {
  const t0 = Date.now(), nb = ctx.nb ?? 13380, key = spec.t9 ? face9KeyWith(spec.info, P, T9_CODE, nb) : face9Key(spec.info, P, nb), url0 = spec.url || (spec.t9 ? BASE_T9() : null);
  if (spec.probe) spec.probe({ P: new Float32Array(P), E: eyes ? new Float32Array(eyes) : null, key, info: spec.info, nb, n: ctx.n });
  let b = await loadFace9(key, url0), built = null;
  if (!b && canBuild(spec)) { built = await buildFace9(F, P, eyes, spec, key, nb, url0); b = built?.b || null; }
  if (!b) return { P, report: { v: FACE9_VERSION, missing: key, ...(built?.error ? { buildError: built.error } : {}), build: 'node: makePerson(<name>, { face9: {} }) builds and caches it (or web/labs/human8/anat8/anat8_f9.mjs --people <name> --write)' } };
  const Q = new Float32Array(P), g = spec.gain ?? 1, k = b.scale * g; let mx = 0;
  for (let i = 0; i < b.n; i++) { const v = b.ids[i]; if (v >= nb) continue; const dx = b.d[i * 3] * k, dy = b.d[i * 3 + 1] * k, dz = b.d[i * 3 + 2] * k; Q[v * 3] += dx; Q[v * 3 + 1] += dy; Q[v * 3 + 2] += dz; mx = Math.max(mx, Math.hypot(dx, dy, dz)); }
  // (lane it22) the eyes seated by the bone
  const E = b.eyes && eyes ? moveEyes9(eyes, b.eyes, g) : null, eyeMm = b.eyes ? Object.fromEntries(['L', 'R'].map(s => [s, b.eyes[s].d.map(x => +(x * g * 1000).toFixed(2))])) : null;
  return { P: Q, ...(E ? { E } : {}), report: { v: FACE9_VERSION, ...(spec.t9 ? { t9: T9_CODE } : {}), key, gain: g, n: b.n, maxMm: +(mx * 1000).toFixed(2), ...(eyeMm ? { eyesMm: eyeMm } : {}), ms: Date.now() - t0, ...(built ? { built: built.info } : {}) } };
}

// ---- (c7 it17) the bake built in the person build (node only)
const isNode = () => typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
const canBuild = spec => spec.build !== false && isNode() && process.env.ANAT8_F9_BUILD !== '0';
const building = new Map();   // key -> promise (two builds of one person in one process share one solve)
function decode(u8) { return parseFace9(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); }
async function buildFace9(F, P, eyes, spec, key, nb, url) {
  if (building.has(key)) return building.get(key);
  const job = (async () => { const t0 = Date.now(), dir = new URL(url || BASE());
    try {
      if (dir.protocol !== 'file:') return { error: 'the cache is not a local folder: ' + dir.href };
      if (!eyes) return { error: 'no eyes at the hook' };
      const fsM = 'node:fs', fs = await import(fsM), B9 = spec.t9 ? await import('../anatomy/tissue9/face/bake.js') : await import('../anatomy/head/bake9.js');
      if (spec.t9 && B9.t9Code() !== T9_CODE) return { error: `the tissue code is ${B9.t9Code()} but face9.js T9_CODE says ${T9_CODE}: bump T9_CODE` };
      if (!spec.t9 && B9.anat8Code() !== ANAT8_CODE) return { error: `the anatomy code is ${B9.anat8Code()} but face9.js ANAT8_CODE says ${ANAT8_CODE}: bump ANAT8_CODE` };
      const st = await (await import('../person/index.js')).loadPersonStudio(), hero = st.S.hero, globes = (await import('./face6.js')).globes;
      const info = { ...spec.info, age: spec.info.age == null ? null : Math.round(spec.info.age) };
      console.log(`face9: no bake for key ${key} (${info.sex} ${info.age} ${info.group} bmi ${info.bmi}): solving it in the person build (node; 6-15 min)`);
      const V = { P: new Float32Array(P), E: new Float32Array(eyes), info, key, seedKey: face9SeedKey(spec.info, P, nb), tri: hero.arr('idx_body'), side: hero.arr('eye_side') };
      const solveOptions = { nb, meta: { by: 'face9.js face9Apply (built in the person build, node)' } };
      const originalSolve = () => spec.t9 ? B9.solveFaceT9(V, { F, globes },
        { nb, meta: { by: 'face9.js face9Apply (t9: built in the person build, node)' } }) :
        B9.solveFace9(V, { F, globes }, solveOptions);
      let r;
      if (!spec.t9 && process.env.ACP_FACE9_SHARED_CACHE === '1' &&
          process.env.ACP_SOFT_CACHE_DIR && process.env.ACP_FACE9_QUALIFICATION_FILE) {
        let solveFace9Cached;
        try { ({ solveFace9Cached } = await import('./face9_shared_cache.mjs')); }
        catch (e) { console.warn('face9: shared cache adapter unavailable; using the original solver: ' + (e?.message || e)); }
        if (typeof solveFace9Cached === 'function') {
          const { fileURLToPath } = await import('node:url');
          r = await solveFace9Cached({ root: fileURLToPath(new URL('../../../', import.meta.url)),
            cacheRoot: process.env.ACP_SOFT_CACHE_DIR,
            qualificationFile: process.env.ACP_FACE9_QUALIFICATION_FILE,
            V, deps: { F, globes },
            options: { ...solveOptions, face9Version: FACE9_VERSION, anatomyCode: ANAT8_CODE, seedCode: SEED_CODE } }, originalSolve);
        } else r = await originalSolve();
      } else r = await originalSolve();
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(new URL(key + '.bin', dir), r.buf); fs.writeFileSync(new URL(key + '.json', dir), JSON.stringify(r.meta, null, 1));
      const b = decode(r.buf); cache.set(dir.href + key, Promise.resolve(b));
      console.log(`face9: built and cached ${key} (${r.n} vertices, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      return { b, info: { key, n: r.n, s: Math.round((Date.now() - t0) / 1000), wrote: new URL(key + '.bin', dir).pathname } };
    } catch (e) { console.warn('face9: the build failed: ' + (e?.stack || e)); return { error: String(e?.message || e) }; } })();
  building.set(key, job); job.finally(() => building.delete(key)); return job;
}
