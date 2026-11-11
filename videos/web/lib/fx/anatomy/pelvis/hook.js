// ANATOMY / PELVIS / HOOK (ANAT8-PELVIS, round 7, 8 Oct 2026; NOTES: review/studio_human_c8/after/anat8_pelvis/NOTES.md): the SOLVED pelvic
// region laid onto a built person's skin. The region (bone -> muscle -> fat compartments -> zones of adherence -> the solve under gravity, pelvis/
// index.js solvePelvis) is computed node-side once per person by labs/human8/anat8p/solve_test.mjs --disp and stored as the displacement of each
// body vertex of the region from the person's own BIND body (BODY7's people7 prior body): hm08's control vertices AND (iteration 3) the Loop level-1
// edge vertices, keyed by their hm08 edge: assets/anatomy/pelvis/<name>.json. Nothing here shapes anything: it carries the solve's skin onto the hero.
//
//   const r = await pelvis7(P, { name })      P = the person (after the body form and the stance); the hero's body bind moves, the pose follows
//   (the person's pelvis slot, lib/fx/person/build.js: makePerson('<name>', { pelvis: { module: 'anatomy/pelvis/hook.js', fn: 'pelvis7' } }); in a farm
//    job person_job.py --popts '{"pelvis":{"module":"anatomy/pelvis/hook.js","fn":"pelvis7"}}'; landed: v7lanes/ANAT8_PELVIS.json)
//
// (lane iteration 14) EVERY PERSON: the bake is KEYED to the person and the code ({ body: soft/envelope.js bodyKey of the prior body the solve is
// made on, code: the skeleton's, muscles', solver's and this region's versions }), as ANAT8-BODY's soft8 keys the breast's. A bake that is current
// for the person being built is laid on; otherwise, in NODE, the region is SOLVED for this person (bakePelvis: the same chain as solve_test.mjs --disp,
// ~8-10 min a person on this box) and written back as the bake, so a CAST-sampled person or a crowd member nobody looked at gets the pelvis too; a
// PAGE never solves (reported skipped). ANAT8_PELVIS_BUILD=0 = node never solves (reads bakes only).
//
// The bind positions are written in place (the first S.nb vertices of the body geometry are hm08's, in order: lib/fx/body/subdiv.js keeps them),
// their normals rebuilt from the faces around them, so the engine, three's CPU skinning, the exporter's subdivision and Cycles all get it, with
// no new attribute (the v5 body's 16 attributes are all in use). A paint the skin shader reads in bind space (vBind) slides with the skin by the
// displacement (mean ~5-15 mm in the region); UV-mapped maps follow the skin exactly.
export const PELVIS_HOOK_VERSION = 4;   // (lane iteration 15) in node the key also carries the region's SOURCE hash (key.src): a bake solved by a process holding an in-progress edit of this module is never taken as current by one holding other code; a solve never overwrites a bake of a newer pelvis version   // (lane iteration 14) the bake keyed to the person and the code, solved on a miss in node; (iteration 3) level 1 written from the bake's own level-1 skin
const ASSETS = new URL('../../../../assets/anatomy/pelvis/', import.meta.url).href;
const dec = (b64, T) => { const s = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return new T(u8.buffer); };
const decodeBake = J => ({ ...J, src: dec(J.src, Uint32Array), loaded: dec(J.loaded, Int16Array), unloaded: J.unloaded ? dec(J.unloaded, Int16Array) : null,
  l1: J.l1 ? { edges: dec(J.l1.edges, Uint32Array), loaded: dec(J.l1.loaded, Int16Array), unloaded: J.l1.unloaded ? dec(J.l1.unloaded, Int16Array) : null } : null });
export async function pelvisBake(name, { url = null } = {}) {
  // (lane iteration 14) one set of bakes, the current one: the A/B folder (assets/anatomy/pelvis/next/, `set`) is deleted with the review gate (15 Oct 17:15)
  let J = null; try { const r = await fetch(url || ASSETS + name + '.json'); if (!r.ok) return null; J = await r.json(); } catch (e) { return null; }
  return J ? decodeBake(J) : null;
}
const isNode = () => typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
const b64 = a => { const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64'); let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
let _code = null;
// the code the bake depends on: ANAT8-BODY's skeleton, muscles and solver, and this region (pelvis/index.js PELVIS_VERSION carries muscles, thigh, fat, tethers)
export async function pelvisCode() {
  if (_code) return _code;
  // the sources' hash is taken in the same step as the region's modules are first imported (ESM caches them: this process solves with exactly these)
  const hs = srcHash(), [SK, MU, SO, PV] = await Promise.all([import('../skeleton/index.js'), import('../muscle/index.js'), import('../soft/index.js'), import('./index.js')]);
  _src = await hs; return (_code = `sk${SK.SKELETON_VERSION}.mu${MU.MUSCLE_VERSION}.so${SO.SOFT_VERSION}.pv${PV.PELVIS_VERSION}`);
}
// (v4, lane iteration 15) NODE ONLY: a hash of the region's own sources (index, fat, muscles, thigh, tethers, data). The version string alone could not
// tell an in-progress edit from the landed code: on 15 Oct (22:10-22:21) other lanes' node builds solved missing bakes with a half-edited module and wrote
// them under the landed version's key. A page compares body + code only (it never solves and cannot read the sources cheaply).
let _src = null;
// the CODE is hashed, not the file: // comments and blank lines are dropped first (strings and template literals kept), so a corrected comment or
// citation does not re-solve every person
export function stripJs(s) { let out = '', q = null; for (let i = 0; i < s.length; i++) { const c = s[i];
    if (q) { out += c; if (c === '\\') { out += s[++i] ?? ''; continue; } if (c === q) q = null; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (c === "'" || c === '"' || c === '`') q = c; out += c; }
  return out.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim()).join('\n'); }
async function srcHash() { if (!isNode()) return '';
  try { const fsM = 'node:fs', crM = 'node:crypto', fs = await import(fsM), cr = await import(crM), h = cr.createHash('sha1');
    for (const f of ['index.js', 'fat.js', 'muscles.js', 'thigh.js', 'tethers.js', 'data.js']) h.update(stripJs(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8')));
    return h.digest('hex').slice(0, 12); } catch (e) { return ''; } }
export async function pelvisSrc() { if (_src === null) await pelvisCode(); return _src || ''; }
// the key of a prior person p (makePerson's P.p; solve_test's priorPerson): the body the solve is made on and the code (+ in node the sources' hash)
export async function pelvisKey(p) {
  if (!p?.built?.pos) return null;
  const S0 = p._S || await (await import('../../body/index.js')).loadBodyStudio(), { bodyKey } = await import('../soft/envelope.js'), src = await pelvisSrc();
  return { body: bodyKey(p.built.pos, S0.nb), code: await pelvisCode(), ...(src ? { src } : {}) };
}
// a bake is current for a key when its body and code match and, where both carry it (node), its sources' hash
export const keyMatches = (bk, key) => !!(bk && key && bk.body === key.body && bk.code === key.code && (!key.src || bk.src === key.src));
// the bake's record from a solve (B: the body the solve was made on; Z: pelvis/index.js solvePelvis's result): the skin displacement from the body
// before (Int16, 0.1 mm, bind frame) of the region's hm08 control vertices (src) and of its Loop level-1 edge vertices (l1.edges: the hm08 edge each
// sits on); loaded = the skin fitted onto the solve's own skin under standing gravity; unloaded = the same at rest
export async function encodeBake(B, Z, name, key, what = '') {
  const PV = await import('./index.js'), src = Uint32Array.from(Z.hm.src), dl = new Int16Array(src.length * 3), du = new Int16Array(src.length * 3);
  for (let k = 0; k < src.length; k++) for (let c = 0; c < 3; c++) { const v0 = B.pos[src[k] * 3 + c]; dl[k * 3 + c] = Math.round((Z.hm.pos[k * 3 + c] - v0) * 1e4); du[k * 3 + c] = Math.round((Z.hm.envFit[k * 3 + c] - v0) * 1e4); }
  const E1 = Uint32Array.from(Z.l1.edges), q16 = a => Int16Array.from(a, v => Math.max(-32767, Math.min(32767, Math.round(v * 1e4))));
  return { name, key, what, pelvis: PV.PELVIS_VERSION, built: new Date().toISOString(), fit: Z.fit, unit: 1e-4, n: src.length, src: b64(src), loaded: b64(dl), unloaded: b64(du),
    l1: { n: E1.length / 2, edges: b64(E1), loaded: b64(q16(Z.l1.d)), unloaded: b64(q16(Z.l1.dU)) } };
}
const building = new Map();
// THE SOLVE for one prior person p, written as the bake (node): the chain solve_test.mjs --disp runs (bodyOf -> buildSkeleton -> buildMuscles ->
// pelvisRegion -> solvePelvis at h 6 mm, 4 s of standing gravity)
export async function bakePelvis(p, name, { write = true, log = console.log, h = 0.006, maxTime = 4 } = {}) {
  const key = await pelvisKey(p), k = name + '|' + key?.body + '|' + key?.code; if (building.has(k)) return building.get(k);
  const job = (async () => {
    const t0 = Date.now(); log(`pelvis: no current pelvis bake for ${name} (key ${key?.body} ${key?.code}): solving it (node; ~8-10 min)`);
    const S0 = p._S || await (await import('../../body/index.js')).loadBodyStudio();
    const [K8, M8, PV] = await Promise.all([import('../skeleton/index.js'), import('../muscle/index.js'), import('./index.js')]);
    const B = K8.bodyOf(S0, p.built, p), K = K8.buildSkeleton(B), M = M8.buildMuscles(B, K, { rec: p }), R = PV.pelvisRegion(B, K, M, { rec: p, version: 2 });
    const Z = await PV.solvePelvis(B, R, { h, solve: { maxTime } });
    const J = await encodeBake(B, Z, name, key, 'ANAT8-PELVIS pelvis v' + PV.PELVIS_VERSION + ', solved by lib/fx/anatomy/pelvis/hook.js bakePelvis on a miss (the chain of solve_test.mjs --disp)');
    J.stats = { residualMmS: Z.stats?.residualMmS ?? null, converged: Z.stats?.converged ?? null, ms: Date.now() - t0 };
    if (write && isNode()) { const fsM = 'node:fs', fs = await import(fsM), dir = new URL(ASSETS), fn = new URL(name + '.json', dir); fs.mkdirSync(dir, { recursive: true });
      // never over a bake of a NEWER pelvis version (a process holding older code must not clobber the landed one)
      let newer = false; try { const O = JSON.parse(fs.readFileSync(fn)); newer = (O.pelvis ?? 0) > PV.PELVIS_VERSION; } catch (e) { }
      if (newer) { log(`pelvis: kept assets/anatomy/pelvis/${name}.json (a newer pelvis version than this process's ${PV.PELVIS_VERSION})`); return J; }
      fs.writeFileSync(fn, JSON.stringify(J)); }
    log(`pelvis: ${write ? 'wrote' : 'solved'} assets/anatomy/pelvis/${name}.json in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    return J; })();
  building.set(k, job); job.finally(() => building.delete(k)); return job;
}
// opts: name (the person's name: the bake's file); which: 'loaded' (default: the solve under gravity) | 'unloaded' (the gravity-free reference, for a
// diagnosis); url / bake: a bake other than the committed one (tests: no key check); build: false = never solve on a miss
export async function pelvis7(P, { name = null, which = 'loaded', url = null, bake = null, build = true } = {}) {
  const h = P?.h, body = h?.body, g0 = body?.userData?.geomL0 || body?.geometry; if (!g0?.index) return { skipped: 'no body geometry' };
  name = name || P?.info?.name;
  let J = bake || await pelvisBake(name, { url }), source = bake || url ? 'given' : 'bake', stale = null, key = null;
  if (!bake && !url && P?.p?.built) { key = await pelvisKey(P.p);
    if (J && key && !keyMatches(J.key, key)) { stale = { bake: J.key || null, person: key }; J = null; }
    if (!J) { if (!(build && isNode() && process.env.ANAT8_PELVIS_BUILD !== '0')) return { version: PELVIS_HOOK_VERSION, skipped: (stale ? 'the pelvis bake is stale for ' : 'no pelvis bake for ') + name + (isNode() ? ' (node build off)' : ' and a page never solves'), key, stale };
      J = decodeBake(await bakePelvis(P.p, name)); source = 'solve'; } }
  if (!J) return { version: PELVIS_HOOK_VERSION, skipped: 'no pelvis bake for ' + name };
  const D = which === 'unloaded' ? J.unloaded : J.loaded, u = J.unit || 1e-4, n0 = g0.attributes.position.count;
  // the control mesh's displacement (hm08 vertex ids; every other control vertex 0)
  const d0 = new Float32Array(n0 * 3); let s = 0, mx = 0, c = 0;
  for (let k = 0; k < J.src.length; k++) { const v = J.src[k]; if (v >= n0) continue; for (let q = 0; q < 3; q++) d0[v * 3 + q] = D[k * 3 + q] * u;
    const l = Math.hypot(d0[v * 3], d0[v * 3 + 1], d0[v * 3 + 2]); s += l; mx = Math.max(mx, l); c++; }
  const done = new Set();
  const apply = (g, d) => { if (!g || done.has(g)) return; done.add(g); const X = g.attributes.position.array, nV = g.attributes.position.count, moved = new Uint8Array(nV);
    for (let v = 0; v < nV; v++) { const o = v * 3; if (d[o] === 0 && d[o + 1] === 0 && d[o + 2] === 0) continue; X[o] += d[o]; X[o + 1] += d[o + 1]; X[o + 2] += d[o + 2]; moved[v] = 1; }
    renormal(g, moved); g.attributes.position.needsUpdate = true; g.computeBoundingSphere?.(); g.computeBoundingBox?.(); };
  apply(g0, d0);
  // a SUBDIVIDED body (the person's detail stage subdivides before this hook runs; lib/fx/body/subdiv.js keeps the control vertices' indices and
  // appends each level's edge vertices). LEVEL 1 (iteration 3: what the render draws): the bake carries the region's skin AT level 1 (pelvis/index.js
  // solvePelvis: the fit is made on the region mesh, which is hm08 split once), so every level-1 vertex of the region takes its own solved displacement:
  // the control vertices theirs, each edge vertex the one baked for its hm08 edge (found through the level's Loop stencil rows, which list the edge's two
  // ends first). Any other level (or a bake without level 1) takes the mean over the vertices of the level below, level by level (Loop's stencils are
  // linear and the field is smooth at that scale).
  const lvl = g => g.userData?.subdiv?.levels ?? 0;
  const subs = Object.entries(body.userData?.geoms || {}).filter(([k, g]) => +k > 0 && g !== g0).map(([, g]) => g);
  if (body.geometry !== g0 && !subs.includes(body.geometry)) subs.push(body.geometry);
  subs.sort((a, b) => lvl(a) - lvl(b));
  const L1 = which === 'unloaded' ? J.l1?.unloaded : J.l1?.loaded, dsub = new Map(); let prev = { n: n0, d: d0 }, l1n = 0;
  for (const g of subs) { const nV = g.attributes.position.count, d = new Float32Array(nV * 3);
    if (lvl(g) === 1 && L1) { d.set(d0.subarray(0, Math.min(d0.length, nV * 3)));
      const St = (g.userData.plan?.levels?.[0] || (await levelPlan(g0)))?.S, nIn = g.userData.subdiv?.nIn ?? n0;
      if (St) { const key = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a, id = new Map(); for (let r = nIn; r < nV; r++) { const o = St.rowOff[r]; id.set(key(St.col[o], St.col[o + 1]), r); }
        const E2 = J.l1.edges; for (let k = 0; k < E2.length / 2; k++) { const r = id.get(key(E2[k * 2], E2[k * 2 + 1])); if (r === undefined) continue; for (let q = 0; q < 3; q++) d[r * 3 + q] = L1[k * 3 + q] * u; l1n++; } }
    } else { const known = new Uint8Array(nV), m0 = Math.min(prev.n, nV); d.set(prev.d.subarray(0, m0 * 3)); known.fill(1, 0, m0);
      const I = g.index.array, adj = Array.from({ length: nV }, () => []); for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) { if (a >= m0 || b >= m0) { adj[a].push(b); adj[b].push(a); } }
      for (let pass = 0; pass < 6; pass++) { let left = 0; const nk = known.slice();
        for (let v = m0; v < nV; v++) { if (known[v]) continue; let m = 0; const acc = [0, 0, 0]; for (const j of adj[v]) if (known[j]) { acc[0] += d[j * 3]; acc[1] += d[j * 3 + 1]; acc[2] += d[j * 3 + 2]; m++; }
          if (m) { d[v * 3] = acc[0] / m; d[v * 3 + 1] = acc[1] / m; d[v * 3 + 2] = acc[2] / m; nk[v] = 1; } else left++; }
        known.set(nk); if (!left) break; } }
    apply(g, d); dsub.set(g, d); prev = { n: nV, d }; }
  // CORRECT5's corrected-bind base (export.js writes correctedBind() over the bind before the export): if it was captured before this hook, it moves too
  const cb = body.userData?.correctBase; if (cb) { const gC = cb.length === g0.attributes.position.count * 3 ? d0 : [...dsub.values()].find(d => d.length === cb.length); if (gC) for (let i = 0; i < cb.length; i++) cb[i] += gC[i]; }
  h.update?.();
  return { version: PELVIS_HOOK_VERSION, bake: J.pelvis ?? null, source, key: J.key ?? null, stale, which, verts: c, l1Edges: l1n, meanMm: +(s / Math.max(1, c) * 1000).toFixed(1), maxMm: +(mx * 1000).toFixed(1), levels: subs.length, correctBase: !!cb };
}
// the normals of the moved vertices and their one-ring, area-weighted from the faces around them
function renormal(g, moved) {
  const N = g.attributes.normal?.array; if (!N) return; const X = g.attributes.position.array, I = g.index.array, nV = g.attributes.position.count, touch = new Uint8Array(nV);
  for (let t = 0; t < I.length; t += 3) if (moved[I[t]] || moved[I[t + 1]] || moved[I[t + 2]]) { touch[I[t]] = touch[I[t + 1]] = touch[I[t + 2]] = 1; }
  const acc = new Float64Array(nV * 3);
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], d = I[t + 2]; if (!(touch[a] || touch[b] || touch[d])) continue;
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], wx = X[d * 3] - X[a * 3], wy = X[d * 3 + 1] - X[a * 3 + 1], wz = X[d * 3 + 2] - X[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; for (const v of [a, b, d]) { acc[v * 3] += nx; acc[v * 3 + 1] += ny; acc[v * 3 + 2] += nz; } }
  for (let v = 0; v < nV; v++) if (touch[v]) { const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]); if (l > 0) { N[v * 3] = acc[v * 3] / l; N[v * 3 + 1] = acc[v * 3 + 1] / l; N[v * 3 + 2] = acc[v * 3 + 2] / l; } }
  g.attributes.normal.needsUpdate = true;
}
// the Loop plan of the body's control mesh (level 1), when the subdivided geometry does not carry its own (lib/fx/body/subdiv.js caches it per mesh)
async function levelPlan(g0) { const { loopPlan } = await import('../../body/subdiv.js'); const p = loopPlan(g0.index.array, g0.attributes.position.count, 1, 'hm08:' + g0.index.count + ':' + g0.attributes.position.count); return p.levels[0]; }
