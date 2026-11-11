// ANATOMY / TISSUE9 / HOOK (TISSUE9-LIMB, round 8, 16 Oct 2026; DESIGN: review/studio_human_c8/after/tissue9_limb/DESIGN.md): THE GROWN LIMB ON THE PERSON.
// The region is grown node-side once per person (limb/index.js growLimb: bone -> muscles grown from their fibres -> fat lobules grown on the fascia -> the
// skin = the tissue's surface), hm08's control vertices of the region are PROJECTED onto that skin (project.js: a shrink-wrap for correspondence), and
// the displacement of each control vertex from the person's own bind body (BODY7's prior body) is the BAKE: assets/anatomy/tissue9/<name>.json.
//   const r = await tissue9(P, { name })     P = the person (after the body form, the stance and the breast's solve); the body's bind moves, every level
// The person's slot: makePerson(name, { pelvis: { module: 'anatomy/tissue9/hook.js', fn: 'tissue9', names: 'all' } }) (the slot the region replaces;
// in a farm job person_job.py --popts '{"pelvis":{"module":"anatomy/tissue9/hook.js","fn":"tissue9","names":"all"}}').
// KEYED: { body: soft/envelope.js bodyKey of the prior body, code: the core's and the region's versions (+ in node a hash of their sources) }. A current
// bake is laid on; a missing or stale one is GROWN in node by the build (~2-3 min a person on this box) and written back (TISSUE9_BUILD=0: never grow);
// a page never grows. Every subdivision level the body holds moves by the SAME displacement carried through its own Loop stencils (body/subdiv.js
// subdividePositions is linear in the control points), so the levels stay the subdivision of the control mesh.
export const TISSUE9_HOOK_VERSION = 1;
const ASSETS = new URL('../../../../assets/anatomy/tissue9/', import.meta.url).href;
const isNode = () => typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
const dec = (b64, T) => { const s = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return new T(u8.buffer); };
const b64 = a => { const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64'); let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
const SRC_FILES = ['grid.js', 'grow.js', 'project.js', 'hook.js', 'limb/index.js', 'limb/attach.js', 'limb/data.js'];
let _code = null, _src = null;
export async function tissue9Code() {
  if (_code) return _code;
  const [LB, SK] = await Promise.all([import('./limb/index.js'), import('../skeleton/index.js')]);
  if (isNode()) { try { const fsM = 'node:fs', crM = 'node:crypto', fs = await import(fsM), cr = await import(crM), h = cr.createHash('sha1');
    for (const f of SRC_FILES) h.update(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')); _src = h.digest('hex').slice(0, 12); } catch (e) { _src = ''; } }
  return (_code = `t9h${TISSUE9_HOOK_VERSION}.limb${LB.TISSUE9_LIMB_VERSION}.sk${SK.SKELETON_VERSION}`);
}
export async function tissue9Key(p) {
  if (!p?.built?.pos) return null;
  const S0 = p._S || await (await import('../../body/index.js')).loadBodyStudio(), { bodyKey } = await import('../soft/envelope.js'), code = await tissue9Code();
  return { body: bodyKey(p.built.pos, S0.nb), code, ...(_src ? { src: _src } : {}) };
}
export const keyMatches = (bk, key) => !!(bk && key && bk.body === key.body && bk.code === key.code && (!key.src || !bk.src || bk.src === key.src));
export async function tissue9Bake(name, { url = null } = {}) {
  let J = null; try { const r = await fetch(url || ASSETS + name + '.json'); if (!r.ok) return null; J = await r.json(); } catch (e) { return null; }
  return J ? { ...J, src: dec(J.src, Uint32Array), d: dec(J.d, Int16Array) } : null;
}
// THE BAKE for one prior person p (node): grow the limb, take its skin, project the region's control vertices onto it
export async function growAndProject(p, { h = 0.005, log = () => {} } = {}) {
  const S0 = p._S || await (await import('../../body/index.js')).loadBodyStudio();
  const [K8, LB, GR, PJ] = await Promise.all([import('../skeleton/index.js'), import('./limb/index.js'), import('../layer/grid.js'), import('./project.js')]);
  const B = K8.bodyOf(S0, p.built, p), K = K8.buildSkeleton(B), Z = LB.growLimb(B, K, { rec: p, h, log });
  const { G } = Z, Fs = new Float32Array(G.n); for (let v = 0; v < G.n; v++) Fs[v] = 0.5 - Z.fields.tissue[v];
  const skin = GR.surfaceNets(GR.makeField(Fs, [G.nx, G.ny, G.nz], G.o, G.h));
  const P0 = B.pos, nb = B.nb, ARMS = new Set([3, 4, 5, 6]), X = Float64Array.from(P0.subarray(0, nb * 3));
  // the region's weight: 1 inside, 0 above the top cut and below the ankle cut, smooth over 4 cm under the top cut and 2.5 cm over the ankle cut
  const ss = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const w = new Float32Array(nb); for (let v = 0; v < nb; v++) { if (B.region && ARMS.has(B.region[v])) continue; const x = P0[v * 3], y = P0[v * 3 + 1], z = P0[v * 3 + 2];
    w[v] = ss((Z.yCut(x, z) - y) / 0.04) * ss((y - Z.yAnk - 0.005) / 0.025); }
  const adj = Array.from({ length: nb }, () => []); { const T = B.tri; for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2]; if (a >= nb || b >= nb || c >= nb) continue; for (const [u, v] of [[a, b], [b, c], [c, a]]) { if (!adj[u].includes(v)) adj[u].push(v); if (!adj[v].includes(u)) adj[v].push(u); } } }
  const H = PJ.skinHash(skin), R = PJ.projectPoints(H, X, adj, { w: i => w[i], side: i => (X[i * 3] > 0.015 ? 1 : X[i * 3] < -0.015 ? -1 : 0), iters: 5, smooth: 3, maxD: 0.08 });
  return { B, K, Z, skin, w, D: R.D, proj: { far: R.far, meanMm: R.meanMm, maxMm: R.maxMm, n: R.n } };
}
export async function encodeBake(B, W, name, key) {
  const src = [], d = []; for (let v = 0; v < B.nb; v++) { if (!(W.w[v] > 0)) continue; src.push(v); for (let q = 0; q < 3; q++) d.push(Math.max(-32767, Math.min(32767, Math.round(W.D[v * 3 + q] * 1e4)))); }
  return { name, key, tissue9: TISSUE9_HOOK_VERSION, built: new Date().toISOString(), unit: 1e-4, n: src.length, src: b64(Uint32Array.from(src)), d: b64(Int16Array.from(d)),
    proj: W.proj, grow: { ms: W.Z.info.ms, timing: W.Z.info.timing, fat: W.Z.info.fat, fatGrownCm3: +W.Z.info.stageB.fatCm3.toFixed(0), fatTargetCm3: +W.Z.info.stageB.fatTargetCm3.toFixed(0), grid: W.Z.info.grid, h: W.Z.info.h } };
}
const building = new Map();
export async function bakeTissue9(p, name, { write = true, log = console.log } = {}) {
  const key = await tissue9Key(p), k = name + '|' + key?.body + '|' + key?.code; if (building.has(k)) return building.get(k);
  const job = (async () => { const t0 = Date.now(); log(`tissue9: no current bake for ${name} (key ${key?.body} ${key?.code}): growing it (node; ~2-3 min)`);
    const W = await growAndProject(p), J = await encodeBake(W.B, W, name, key); J.ms = Date.now() - t0;
    if (write && isNode()) { const fsM = 'node:fs', fs = await import(fsM), dir = new URL(ASSETS); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(new URL(name + '.json', dir), JSON.stringify(J)); }
    log(`tissue9: ${write ? 'wrote' : 'grew'} assets/anatomy/tissue9/${name}.json in ${((Date.now() - t0) / 1000).toFixed(0)} s`); return J; })();
  building.set(k, job); job.finally(() => building.delete(k)); return job;
}
// THE SLOT: lay the bake on the person's body (every level)
export async function tissue9(P, { name = null, url = null, bake = null, build = true } = {}) {
  const h = P?.h, body = h?.body, g0 = body?.userData?.geomL0 || body?.geometry; if (!g0?.index) return { skipped: 'no body geometry' };
  name = name || P?.info?.name;
  let J = bake || await tissue9Bake(name, { url }), source = bake || url ? 'given' : 'bake', stale = null, key = null;
  if (!bake && !url && P?.p?.built) { key = await tissue9Key(P.p);
    if (J && key && !keyMatches(J.key, key)) { stale = { bake: J.key || null, person: key }; J = null; }
    if (!J) { if (!(build && isNode() && process.env.TISSUE9_BUILD !== '0')) return { version: TISSUE9_HOOK_VERSION, skipped: (stale ? 'the tissue9 bake is stale for ' : 'no tissue9 bake for ') + name + (isNode() ? ' (node build off)' : ' and a page never grows'), key, stale };
      const E = await bakeTissue9(P.p, name); J = { ...E, src: dec(E.src, Uint32Array), d: dec(E.d, Int16Array) }; source = 'grown'; } }
  if (!J) return { version: TISSUE9_HOOK_VERSION, skipped: 'no tissue9 bake for ' + name };
  const u = J.unit || 1e-4, n0 = g0.attributes.position.count, d0 = new Float32Array(n0 * 3); let s = 0, mx = 0, c = 0;
  for (let k = 0; k < J.src.length; k++) { const v = J.src[k]; if (v >= n0) continue; for (let q = 0; q < 3; q++) d0[v * 3 + q] = J.d[k * 3 + q] * u; const l = Math.hypot(d0[v * 3], d0[v * 3 + 1], d0[v * 3 + 2]); s += l; mx = Math.max(mx, l); c++; }
  const done = new Set(), apply = (g, d) => { if (!g || done.has(g)) return; done.add(g); const X = g.attributes.position.array, nV = g.attributes.position.count, moved = new Uint8Array(nV);
    for (let v = 0; v < nV; v++) { const o = v * 3; if (d[o] === 0 && d[o + 1] === 0 && d[o + 2] === 0) continue; X[o] += d[o]; X[o + 1] += d[o + 1]; X[o + 2] += d[o + 2]; moved[v] = 1; }
    renormal(g, moved); g.attributes.position.needsUpdate = true; g.computeBoundingSphere?.(); g.computeBoundingBox?.(); };
  apply(g0, d0);
  // every subdivided level: the same control displacement through its own plan (linear: the levels stay the subdivision of the moved control mesh)
  const subs = Object.values(body.userData?.geoms || {}).filter(g => g && g !== g0); if (body.geometry !== g0 && !subs.includes(body.geometry)) subs.push(body.geometry);
  let nl = 0; if (subs.length) { const SD = await import('../../body/subdiv.js');
    for (const g of subs) { const lv = g.userData?.subdiv?.levels ?? 1, plan = g.userData?.plan || SD.loopPlan(g0.index.array, n0, lv, 'hm08:' + g0.index.count + ':' + n0);
      const dl = SD.subdividePositions(plan, d0, { compensate: 1 }); if (dl.length === g.attributes.position.count * 3) { apply(g, dl); nl++; } } }
  const cb = body.userData?.correctBase; if (cb && cb.length === d0.length) for (let i = 0; i < cb.length; i++) cb[i] += d0[i];
  h.update?.();
  return { version: TISSUE9_HOOK_VERSION, source, key: J.key ?? null, stale, verts: c, levels: nl, meanMm: +(s / Math.max(1, c) * 1000).toFixed(1), maxMm: +(mx * 1000).toFixed(1), proj: J.proj || null };
}
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
