// ANATOMY / SOFT / HOOK (ANAT8-BODY, c5 run iteration 1 = lane iteration 17, 15 Oct 2026): THE SOFT-TISSUE SOLVE AS THE PERSON'S TISSUE, IN THE BUILD.
// The person's `soft` slot (lib/fx/person/build.js; landed by v7lanes/ANAT8_BODY.json { soft: { module: 'anatomy/soft/hook.js', fn: 'soft8', names: 'all' } }):
// after the body form, the stance (BODY7's girdle7) and BODY7's girdle layer, before ANAT8-PELVIS's pelvis7. ONE hook: the integrator carried this chain in
// lib/fx/person/soft7.js (15 Oct 17:02-17:14) while the lane's first text was out of the tree; this is that chain, back in the lane's folder.
//   the ENVELOPES: the lane's BAKE (assets/anatomy/soft/<name>.json, soft/envelope.js's format) when its KEY is current for the person being built
//   ({ body: envelope.js bodyKey(the prior body the solve is made on), solver: softCode() = the skeleton's, muscles', solver's, breast region's and the
//   format's versions }); otherwise, in NODE, THE SOLVE itself (bakeSoft: soft/breast.js solveBreast on this person's own prior body, both sides,
//   10-75 min a woman) written back as that bake, so the next build, the page and the export read it; a PAGE never solves (reported, skin as built).
//   the FIT: BODY7's ONE membrane fit (lib/fx/body/membrane7.js fitMembrane7, read only), written into every subdivision level the body holds,
//   girdle7's saved copy, CORRECT5's corrected-bind base and SKIN7's painted areola centres.
// Nothing here shapes anything: the form is the solver's (skeleton -> muscles -> the gland and fat -> the skin membrane, under gravity and the load
// history), the fit is BODY7's. Said plainly: the men (no male chest region solved yet: the trunk subcutis is NEXT) and the dressed register (the
// garments were draped on form 1) are reported skipped. ANAT8_SOFT_BUILD=0 = node never solves (reads bakes only).
import { fitEnvs, decodeEnvelope, encodeSide, bodyKey } from './envelope.js';
export const SOFT_HOOK_VERSION = 3;   // 3 (15 Oct, lane iteration 18): the nipple-areola complex at the SOLVE's tracked nipple (the as-built one taken off; no held disc); 2 (15 Oct): the integrator's soft7.js chain (the bake written back on a miss) in the lane's folder; 1 was soft8's first text (16:58, read only)
const ASSETS = new URL('../../../../assets/anatomy/soft/', import.meta.url).href;
const isNode = () => typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
let _code = null;
export async function softCode() {
  if (_code) return _code;
  const [SK, MU, SO, SB, EN] = await Promise.all([import('../skeleton/index.js'), import('../muscle/index.js'), import('./index.js'), import('./breast.js'), import('./envelope.js')]);
  return (_code = `sk${SK.SKELETON_VERSION}.mu${MU.MUSCLE_VERSION}.so${SO.SOFT_VERSION}.br${SB.SOFT_BREAST_VERSION}.env${EN.ENVELOPE_VERSION}`);
}
export async function personKey(P) {
  const p = P?.p; if (!p?.built) return null;
  const S0 = p._S || await (await import('../../body/index.js')).loadBodyStudio();
  return { body: bodyKey(p.built.pos, S0.nb), solver: await softCode() };
}
const _bakes = new Map();
const loadBake = name => { const u = ASSETS + name + '.json'; if (!_bakes.has(u)) _bakes.set(u, fetch(u).then(r => (r.ok === false ? null : r.json())).catch(() => null)); return _bakes.get(u); };
const building = new Map();
// the BAKE: both sides solved on the prior person p (soft/breast.js solveBreast's defaults: the same chain as membrane7.js breastEnvelopes7) and written as the
// lane's envelope bake with its key (node). The hook calls it on a miss; labs/human8/anat8b/soft_bake.mjs calls it for a list of people (one process a person).
export async function bakeSoft(p, name, { write = true, log = console.log } = {}) {
  const S0 = p._S || await (await import('../../body/index.js')).loadBodyStudio(), K = { body: bodyKey(p.built.pos, S0.nb), solver: await softCode() };
  const k = name + '|' + K.body + '|' + K.solver; if (building.has(k)) return building.get(k);
  const job = (async () => {
    const t0 = Date.now();
    log(`soft: no current breast bake for ${name} (key ${K.body} ${K.solver}): solving it (node; 10-45 min a side)`);
    const [K8, M8, SB, SO] = await Promise.all([import('../skeleton/index.js'), import('../muscle/index.js'), import('./breast.js'), import('./index.js')]);
    const B = K8.bodyOf(S0, p.built, p), Ks = K8.buildSkeleton(B), M = M8.buildMuscles(B, Ks, { rec: p, version: 2 });
    const sides = {}, report = {};
    for (const side of ['L', 'R']) { const t1 = Date.now(), Z = SB.solveBreast(B, Ks, M, { rec: p, side }), st = Z.L.stats, c = Z.report?.checks || {};
      sides[side] = encodeSide(Z, { k: 1 });
      report[side] = { converged: st.converged, steps: st.steps, residualMmS: st.residualMmS, volErrPct: st.surfVolCm3?.errPct, inverted: st.inverted, ms: Date.now() - t1,
        checks: Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v !== 'object')), shape: Z.report?.shape || null, history: st.creep ? { development: st.creep.development || null, lactation: st.creep.lactation ? { g: st.creep.lactation.g, dVml: st.creep.lactation.dVml } : null } : null };
      log(`soft: ${name} ${side} solved in ${((Date.now() - t1) / 1000).toFixed(0)} s (converged ${st.converged}; ${sides[side].n} envelope vertices)`); }
    const J = { kind: 'anat8b-soft-envelope', version: (await import('./envelope.js')).ENVELOPE_VERSION, name, key: K, built: new Date().toISOString(),
      by: 'lib/fx/anatomy/soft/hook.js bakeSoft (node)', solver: { soft: SO.SOFT_VERSION, breast: SB.SOFT_BREAST_VERSION, solve: 'solveBreast defaults (= membrane7.js breastEnvelopes7)', k: 1 },
      note: 'ANAT8-BODY: the breast solved under gravity on this person\'s own prior body (our anatomy and tissue model); BODY7\'s membrane fit reads it (soft/envelope.js fitEnvs)', report, sides };
    if (write) { const fsM = 'node:fs', fs = await import(fsM), dir = new URL(ASSETS); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(new URL(name + '.json', dir), JSON.stringify(J)); }
    _bakes.set(ASSETS + name + '.json', Promise.resolve(J));
    log(`soft: ${write ? 'wrote' : 'solved (not written)'} assets/anatomy/soft/${name}.json in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    return J; })();
  building.set(k, job); job.finally(() => building.delete(k)); return job;
}
// the person's soft slot: fn(P, { name, register, ...opts })
export async function soft8(P, { name = null, register = 'bare', sides = ['L', 'R'], fit = {}, build = true } = {}) {
  const h = P?.h, body = h?.body, g = body?.geometry, sex = P?.p?.sex || h?.sex;
  // the A/B arm (lane iteration 20; the c5 run's critic, claim F: a same-pin control of the person WITHOUT the slot, for the farm's clay --clay-ab): node only
  if (isNode() && process.env.ANAT8_SOFT === 'off') return { version: SOFT_HOOK_VERSION, skipped: 'ANAT8_SOFT=off (the A/B arm: this person without the soft slot)' };
  if (register !== 'bare') return { version: SOFT_HOOK_VERSION, skipped: 'dressed register: the garments were draped on form 1; the skin under them is not moved' };
  if (!g?.index) return { version: SOFT_HOOK_VERSION, skipped: 'no body geometry' };
  if (!P?.p?.built) return { version: SOFT_HOOK_VERSION, skipped: 'no prior body (P.p.built)' };
  if (sex !== 'f') return { version: SOFT_HOOK_VERSION, skipped: 'no solved region of the male chest yet (ANAT8-BODY: the trunk subcutis)' };
  name = name || P?.info?.name;
  const t0 = Date.now(), X = g.attributes.position.array, n = g.attributes.position.count, sc = h.scale || 1, K = await personKey(P);
  let J = await loadBake(name), source = 'bake', stale = null;
  if (J && !(J.key && J.key.body === K.body && J.key.solver === K.solver)) { stale = { bake: J.key || null, person: K }; J = null; }
  if (!J) { if (!(build && isNode() && process.env.ANAT8_SOFT_BUILD !== '0')) return { version: SOFT_HOOK_VERSION, skipped: (stale ? 'the bake is stale' : 'no bake') + (isNode() ? ' (node build off)' : ' and a page never solves'), key: K, stale };
    J = await bakeSoft(P.p, name); source = 'solve'; }
  const E8 = decodeEnvelope(J), envs = fitEnvs(E8, { scale: sc }).filter(e => sides.includes(e.side));
  const [MB, NP] = await Promise.all([import('../../body/membrane7.js'), import('../../body/nipple.js')]);
  let G7 = null; try { G7 = await import('../../body/girdle7.js'); } catch (e) { G7 = null; }
  const sv = G7?.girdleSaved7?.(h), base = Float64Array.from(X); if (sv) for (let i = 0; i < sv.idx.length; i++) for (let j = 0; j < 3; j++) base[3 * sv.idx[i] + j] = sv.pos[3 * i + j];
  const nipAt = () => { try { return NP.nippleAt(h, { sex: 'f', scale: 1 / sc }); } catch (e) { return null; } }, nipBefore = nipAt();
  // (v3, lane iteration 18) WHO OWNS THE NIPPLE: the solve. 'solve' (the default): the as-built NAC (NAC7's relief at BODY7's rule point) is taken off
  // the skin, the skin is fitted onto the solved envelope everywhere (no held disc), and NAC7's own areola-and-papilla profile is raised at the solve's
  // TRACKED nipple along the fitted skin's normal. (Tried and removed, 22:31: sliding the skin along the fitted surface to carry NAC7's dense nipple patch
  // onto the solve's nipple; on L22 the per-vertex attributes that stay with the vertices (CORRECT5's corrective deltas in the export's corrected bind)
  // then sat 17 mm from where they were made and the breast's skin came 0.7-1.7 mm inside the solve: the patch belongs where NAC7's relay lays it out.)
  // (v2's arm, 'rule': the disc held at the rule point, { nac: 'rule' } / ANAT8_SOFT_NAC=rule, DELETED in lane iteration 19: the critic asked for it to go and
  // the only job that rendered it (C 1015-214522) was withdrawn unclaimed, superseded; git history keeps it.)
  const { nac: _nacGone, ...fitO } = fit, mode = 'solve', T8 = topo8(g);
  const relief0 = nipBefore && nipBefore.source !== 'landmark';
  const hold = [];
  const base0 = mode === 'solve' && relief0 ? Float64Array.from(base) : null, flat = {};
  if (base0) for (const e of envs) flat[e.side] = flattenNAC(base, g, T8, nipBefore[e.side], nipBefore.r);
  const F = MB.fitMembrane7(h, envs, { base, hold, ...fitO }), D = F.D;
  if (base0) for (let i = 0; i < D.length; i++) D[i] += base[i] - base0[i];   // the displacement from the as-built skin: the old relief goes with the fit
  const nac8 = {}; if (mode === 'solve') for (const e of envs) { const s = E8.sides[e.side];
    nac8[e.side] = nacAt(base0 || base, D, g, T8, e.nipple, s?.nippleN || null, nipBefore?.r ?? NP.NIPPLE7.f.r / sc, NP.NAC7.f, 1 / sc); }
  const moved = new Uint8Array(n); for (let v = 0; v < n; v++) { const o = 3 * v; if (D[o] === 0 && D[o + 1] === 0 && D[o + 2] === 0) continue; X[o] += D[o]; X[o + 1] += D[o + 1]; X[o + 2] += D[o + 2]; moved[v] = 1; }
  const kept = G7?.girdleBindEdit7 ? G7.girdleBindEdit7(h, D) : 0;
  renormal(g, moved); g.attributes.position.needsUpdate = true; g.computeBoundingSphere?.();
  const levels = carryLevels(body, g, D);
  const cb = body.userData?.correctBase; let cbDone = false;
  if (cb) { const Dc = cb.length === D.length ? D : levels.byLen.get(cb.length); if (Dc) { for (let i = 0; i < cb.length; i++) cb[i] += Dc[i]; cbDone = true; } }
  // SKIN7's painted areola (likeAreo0 = nippleAt's L, likeAreo1 = R; centres in bind space): 'solve' puts each centre ON the raised papilla's top, so colour
  // and form are one complex at the solve's nipple (without a raised papilla: carried with the skin under it)
  const U = h.likeness?.skin?.U, areo = [];
  for (const [k, side] of [['likeAreo0', 'L'], ['likeAreo1', 'R']]) { const u = U?.[k]?.value; if (!u || !(u.x || u.y || u.z)) continue;
    const N8 = nac8[side]; if (N8?.peak >= 0) { const o = 3 * N8.peak, d = Math.hypot(X[o] - u.x, X[o + 1] - u.y, X[o + 2] - u.z); u.x = X[o]; u.y = X[o + 1]; u.z = X[o + 2]; areo.push(+(d * sc * 1000).toFixed(1)); continue; }
    let vb = -1, bd = Infinity;
    for (let v = 0; v < n; v++) { const d = (base[3 * v] - u.x) ** 2 + (base[3 * v + 1] - u.y) ** 2 + (base[3 * v + 2] - u.z) ** 2; if (d < bd) { bd = d; vb = v; } }
    if (vb >= 0) { u.x += D[3 * vb]; u.y += D[3 * vb + 1]; u.z += D[3 * vb + 2]; areo.push(+(Math.hypot(D[3 * vb], D[3 * vb + 1], D[3 * vb + 2]) * sc * 1000).toFixed(1)); } }
  // the person's nipple-areola placement, published for the later layers (DETAIL7's fine NAC, the garments): bind space, the solve's
  if (mode === 'solve' && nac8.L?.at && nac8.R?.at) body.userData.nac8 = { L: nac8.L.at, R: nac8.R.at, n: { L: nac8.L.n, R: nac8.R.n }, r: nipBefore?.r ?? NP.NIPPLE7.f.r / sc, source: 'soft8: the solve\'s tracked nipple', version: SOFT_HOOK_VERSION };
  h.update?.();
  const mm3 = (a, b) => a && b ? [0, 1, 2].map(j => +((a[j] - b[j]) * sc * 1000).toFixed(1)) : null;
  const nipAfter = nipAt(), nacOff = envs.map(e => { const q = nipAfter?.[e.side], s = e.nipple; return q && s ? { side: e.side, dxMm: +((q[0] - s[0]) * sc * 1000).toFixed(1), dyMm: +((q[1] - s[1]) * sc * 1000).toFixed(1), dzMm: +((q[2] - s[2]) * sc * 1000).toFixed(1) } : null; });
  const nacRep = { mode, sides: envs.map(e => { const N8 = nac8[e.side] || {}, fl = flat[e.side] || {};
    return { side: e.side, solveMinusRuleMm: mm3(e.nipple, nipBefore?.[e.side]), oldReliefRemovedMm: fl.removed != null ? +(fl.removed * sc * 1000).toFixed(2) : null, flattened: fl.verts ?? null,
      axisVsSolveDeg: N8.axisDeg ?? null, pitchDeg: N8.pitchDeg ?? null, outDeg: N8.outDeg ?? null, peakMm: N8.peakH != null ? +(N8.peakH * sc * 1000).toFixed(2) : null, snapMm: N8.snap != null ? +(N8.snap * sc * 1000).toFixed(2) : null,
      vertices: N8.verts ?? null, edgeMm: N8.el != null ? +(N8.el * sc * 1000).toFixed(2) : null, peakFromSolveMm: N8.peak >= 0 ? +(Math.hypot(...mm3([X[3 * N8.peak], X[3 * N8.peak + 1], X[3 * N8.peak + 2]], e.nipple))).toFixed(1) : null,
      ruleOnFittedMinusNacMm: N8.at ? mm3(nipAfter?.[e.side], N8.at) : null }; }) };
  return { version: SOFT_HOOK_VERSION, name, source, key: K, stale, fit: F.stats, levels: levels.report, girdleSavedEdited: kept, correctBase: cbDone, areolaMovedMm: areo, nac: nacRep, nacMinusSolvedNipple: nacOff,
    solve: envs.map(e => ({ side: e.side, ...(e.report || {}) })), ms: Date.now() - t0 };
}
// ---------------------------------------------------------------- the nipple-areola complex at the solve's nipple (v3)
// topology of the body geometry: CSR neighbours, vertex -> triangles, and the torso's vertices that belong to a triangle (hm08 keeps loose ones)
const _t8 = new WeakMap();
function topo8(g) {
  const I = g.index.array, n = g.attributes.position.count; let T = _t8.get(g); if (T && T.nI === I.length) return T;
  const deg = new Int32Array(n + 1), tdeg = new Int32Array(n + 1), seen = new Set(), E = [];
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3], k = a < b ? a * n + b : b * n + a; tdeg[a + 1]++; if (seen.has(k)) continue; seen.add(k); E.push(a, b); deg[a + 1]++; deg[b + 1]++; }
  for (let v = 0; v < n; v++) { deg[v + 1] += deg[v]; tdeg[v + 1] += tdeg[v]; }
  const nb = new Int32Array(deg[n]), f = deg.slice(0, n); for (let i = 0; i < E.length; i += 2) { nb[f[E[i]]++] = E[i + 1]; nb[f[E[i + 1]]++] = E[i]; }
  const vt = new Int32Array(tdeg[n]), tf = tdeg.slice(0, n); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) vt[tf[I[t + e]]++] = t / 3;
  const A = g.attributes.aHero, R = A?.array, st = A?.itemSize || 4, torso = new Uint8Array(n); for (let i = 0; i < I.length; i++) { const v = I[i]; if (!R || Math.round(R[v * st]) === 2) torso[v] = 1; }
  T = { nI: I.length, off: deg, nb, toff: tdeg, vt, torso }; _t8.set(g, T); return T;
}
function vnormal(X, I, T, v) { let nx = 0, ny = 0, nz = 0;
  for (let k = T.toff[v]; k < T.toff[v + 1]; k++) { const t = T.vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], wx = X[c] - X[a], wy = X[c + 1] - X[a + 1], wz = X[c + 2] - X[a + 2]; nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nz += ux * wy - uy * wx; }
  const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; }
function frameOf(nn) { let t1 = [1 - nn[0] * nn[0], -nn[0] * nn[1], -nn[0] * nn[2]]; const tl = Math.hypot(...t1) || 1; t1 = t1.map(x => x / tl);
  return [t1, [nn[1] * t1[2] - nn[2] * t1[1], nn[2] * t1[0] - nn[0] * t1[2], nn[0] * t1[1] - nn[1] * t1[0]]]; }
// the torso vertices within R of q (3D) whose normal faces nn's way, with their local (u, w, z) in q's tangent frame
function localPatch(X, I, T, q, R, nn = null) {
  const n = X.length / 3, near = []; for (let v = 0; v < n; v++) { if (!T.torso[v]) continue; const d = Math.hypot(X[3 * v] - q[0], X[3 * v + 1] - q[1], X[3 * v + 2] - q[2]); if (d < R) near.push(v); }
  if (!nn) { let s = [0, 0, 0]; for (const v of near) { const m = vnormal(X, I, T, v); s = [s[0] + m[0], s[1] + m[1], s[2] + m[2]]; } const l = Math.hypot(...s) || 1; nn = s.map(x => x / l); }
  const [t1, t2] = frameOf(nn), L = [];
  for (const v of near) { const m = vnormal(X, I, T, v); if (m[0] * nn[0] + m[1] * nn[1] + m[2] * nn[2] < 0.5) continue; const d = [X[3 * v] - q[0], X[3 * v + 1] - q[1], X[3 * v + 2] - q[2]];
    L.push({ v, u: d[0] * t1[0] + d[1] * t1[1] + d[2] * t1[2], w: d[0] * t2[0] + d[1] * t2[1] + d[2] * t2[2], z: d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2] }); }
  return { nn, t1, t2, L };
}
function solve6(M, b) { const n = b.length, A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; const d = A[c][c] || 1e-30;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / d; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; } }
  return A.map((r, i) => r[n] / (r[i] || 1e-30)); }
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// THE OLD RELIEF OFF (mesh repair, no shape set): NAC7 raised an areolar mound and a papilla (out to 1.1 areola radii) at the rule point; inside
// 1.1 r the skin's height over the tangent plane becomes the chest's own surface there, a least-squares quadratic of the annulus 1.25-2.2 r
// round it, blended back to the skin's own heights by 1.35 r. Edits `base` in place (the fit starts from it and takes its rest Laplacian from it).
function flattenNAC(base, g, T, q, r) {
  if (!q) return { skipped: 'no point' }; const I = g.index.array, P = localPatch(base, I, T, q, 2.6 * r), ring = P.L.filter(p => { const rho = Math.hypot(p.u, p.w); return rho > 1.25 * r && rho < 2.2 * r; });
  if (ring.length < 12) return { skipped: 'annulus ' + ring.length };
  const M = Array.from({ length: 6 }, () => new Array(6).fill(0)), b = new Array(6).fill(0);
  for (const p of ring) { const u = p.u / r, w = p.w / r, B = [1, u, w, u * u, u * w, w * w]; for (let i = 0; i < 6; i++) { b[i] += B[i] * p.z; for (let j = 0; j < 6; j++) M[i][j] += B[i] * B[j]; } }
  for (let i = 0; i < 6; i++) M[i][i] += 1e-9; const c = solve6(M, b), quad = (u, w) => c[0] + c[1] * u + c[2] * w + c[3] * u * u + c[4] * u * w + c[5] * w * w;
  let removed = 0, k = 0;
  for (const p of P.L) { const rho = Math.hypot(p.u, p.w); if (rho >= 1.35 * r) continue; const t = sst(1.1 * r, 1.35 * r, rho), z = (1 - t) * quad(p.u / r, p.w / r) + t * p.z, dz = z - p.z; if (!dz) continue;
    for (let j = 0; j < 3; j++) base[3 * p.v + j] += dz * P.nn[j]; removed = Math.max(removed, -dz); k++; }
  return { removed, verts: k, ring: ring.length };
}
// THE NAC AT THE SOLVE'S NIPPLE: NAC7's own relief (lib/fx/body/nipple.js nippleRelief7's step 2 and its constants NAC7.f, read only; BODY7's
// profile, applied here at the solve's point because nippleRelief7 places it at the rule point): the skin drawn tangentially toward the point
// so a vertex stands at the papilla's top (a smooth warp, all the way or half, whichever turns no triangle), then the areolar mound (radius r,
// height areolaH) and the papilla (a Gaussian, papH high, sigma max(papS, 0.8 of the local edge)) along ONE normal: the fitted skin's mean over
// the areola. Positions are base0 + D (the fitted skin); the relief is added into D. q: the solve's tracked nipple (bind units).
function nacAt(base0, D, g, T, q, qN, r, K, scale) {
  if (!q) return { skipped: 'no solved nipple' };
  const I = g.index.array, n = base0.length / 3, X = new Float64Array(3 * n); for (let i = 0; i < X.length; i++) X[i] = base0[i] + D[i];
  // the axis: the fitted skin's mean normal over the papilla's base (0.5 r), the surface normal at the nipple (the whole areola's mean leans
  // toward the lower pole's turn: 14 deg down on L08); the areola's mean only where the base holds too few vertices
  const P0 = localPatch(X, I, T, q, 0.5 * r), P = localPatch(X, I, T, q, 1.4 * r, P0.L.length >= 6 ? P0.nn : null), nn = P.nn; if (P.L.length < 6) return { skipped: 'no surface (' + P.L.length + ')' };
  let vb = -1, tb = Infinity; for (const p of P.L) { const t = Math.hypot(p.u, p.w); if (t < tb) { tb = t; vb = p.v; } }
  let el = 0, ec = 0; for (let k = T.off[vb]; k < T.off[vb + 1]; k++) { const u = T.nb[k]; el += Math.hypot(X[3 * u] - X[3 * vb], X[3 * u + 1] - X[3 * vb + 1], X[3 * u + 2] - X[3 * vb + 2]); ec++; } el /= Math.max(1, ec);
  // a warp is refused only if it turns a triangle that faced nn's way before it (one already turned, e.g. L22's 13 mm below her nipple, must not block it)
  const facing = t => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2], ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], wx = X[c] - X[a], wy = X[c + 1] - X[a + 1], wz = X[c + 2] - X[a + 2];
    return (uy * wz - uz * wy) * nn[0] + (uz * wx - ux * wz) * nn[1] + (ux * wy - uy * wx) * nn[2] > 0; };
  const faced0 = new Map(); for (const p of P.L) for (let k = T.toff[p.v]; k < T.toff[p.v + 1]; k++) { const t = T.vt[k]; if (!faced0.has(t)) faced0.set(t, facing(t)); }
  const okTris = v => { for (let k = T.toff[v]; k < T.toff[v + 1]; k++) { const t = T.vt[k]; if (faced0.get(t) !== false && !facing(t)) return false; } return true; };
  // the warp: the papilla's vertex to the point (its tangential offset tv), a disc of radius rW following by a smoothstep
  let snap = 0; { const pb = [X[3 * vb], X[3 * vb + 1], X[3 * vb + 2]], d = [pb[0] - q[0], pb[1] - q[1], pb[2] - q[2]], dn = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2], tv = [d[0] - dn * nn[0], d[1] - dn * nn[1], d[2] - dn * nn[2]];
    if (tb > 0) { const rW = Math.min(1.3 * r, Math.max(0.8 * r, 4 * tb)), wv = [];
      for (const p of P.L) { const e = [X[3 * p.v] - pb[0], X[3 * p.v + 1] - pb[1], X[3 * p.v + 2] - pb[2]], en = e[0] * nn[0] + e[1] * nn[1] + e[2] * nn[2], rho = Math.hypot(e[0] - en * nn[0], e[1] - en * nn[1], e[2] - en * nn[2]);
        if (rho >= rW) continue; const t = rho / rW; wv.push([p.v, 1 - t * t * (3 - 2 * t), [X[3 * p.v], X[3 * p.v + 1], X[3 * p.v + 2]]]); }
      for (const f of [1, 0.5, 0.25]) { for (const [v, w, p0] of wv) for (let j = 0; j < 3; j++) X[3 * v + j] = p0[j] - f * w * tv[j];
        if (wv.every(([v]) => okTris(v))) { snap = f * tb; break; } for (const [v, , p0] of wv) for (let j = 0; j < 3; j++) X[3 * v + j] = p0[j]; } } }
  // the relief along nn
  const sP = Math.max(K.papS * scale, 0.8 * el), hA = K.areolaH * scale, hP = K.papH * scale; let peak = -1, peakH = 0, verts = 0;
  for (const p of P.L) { const v = p.v, d = [X[3 * v] - q[0], X[3 * v + 1] - q[1], X[3 * v + 2] - q[2]], dn = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2], rho = Math.hypot(d[0] - dn * nn[0], d[1] - dn * nn[1], d[2] - dn * nn[2]);
    const tA = Math.min(1, Math.max(0, (rho - 0.65 * r) / (0.45 * r))), a = hA * (1 - tA * tA * (3 - 2 * tA)) + hP * Math.exp(-((rho / sP) ** 2)); if (a <= 1e-6 * scale) continue;
    for (let j = 0; j < 3; j++) X[3 * v + j] += a * nn[j]; verts++; if (a > peakH) { peakH = a; peak = v; } }
  // into D (the warp and the relief); what it reports: the axis against the solve's own skin normal at its nipple, and the axis's pitch and outward turn
  for (const p of P.L) { const v = p.v; for (let j = 0; j < 3; j++) D[3 * v + j] = X[3 * v + j] - base0[3 * v + j]; }
  const deg = x => +(Math.acos(Math.max(-1, Math.min(1, x))) * 180 / Math.PI).toFixed(1);
  const axisDeg = qN ? deg(nn[0] * qN[0] + nn[1] * qN[1] + nn[2] * qN[2]) : null, pitchDeg = +(Math.asin(Math.max(-1, Math.min(1, nn[1]))) * 180 / Math.PI).toFixed(1), outDeg = +(Math.atan2(Math.abs(nn[0]), nn[2]) * 180 / Math.PI).toFixed(1);
  return { at: peak >= 0 ? [X[3 * peak], X[3 * peak + 1], X[3 * peak + 2]] : null, n: nn, peak, peakH, snap, el, verts, axisDeg, pitchDeg, outDeg };
}
// the same displacement on every other subdivision level the body holds (lib/fx/body/subdiv.js keeps the level below's vertices first and appends
// its edge vertices): a lower level takes the shared vertices' displacement; a higher one gives each new vertex the mean of its known neighbours
function carryLevels(body, g, D) {
  const ud = body.userData || {}, all = [ud.geomL0, ...Object.values(ud.geoms || {})].filter(Boolean), seen = new Set([g]), byLen = new Map([[D.length, D]]), report = [];
  const lvl = x => x?.userData?.subdiv?.levels ?? 0, order = [...new Set(all)].filter(x => x !== g && x?.attributes?.position).sort((a, b) => lvl(a) - lvl(b));
  for (const G of order) { if (seen.has(G)) continue; seen.add(G);
    const nV = G.attributes.position.count, d = new Float32Array(nV * 3), m0 = Math.min(nV, D.length / 3); d.set(D.subarray(0, m0 * 3));
    if (nV > m0) { const I = G.index.array, adj = Array.from({ length: nV }, () => []), known = new Uint8Array(nV); known.fill(1, 0, m0);
      for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) if (a >= m0 || b >= m0) { adj[a].push(b); adj[b].push(a); }
      for (let pass = 0; pass < 8; pass++) { let left = 0; const nk = known.slice();
        for (let v = m0; v < nV; v++) { if (known[v]) continue; let c = 0, x = 0, y = 0, z = 0; for (const j of adj[v]) if (known[j]) { x += d[j * 3]; y += d[j * 3 + 1]; z += d[j * 3 + 2]; c++; }
          if (c) { d[v * 3] = x / c; d[v * 3 + 1] = y / c; d[v * 3 + 2] = z / c; nk[v] = 1; } else left++; }
        known.set(nk); if (!left) break; } }
    const X = G.attributes.position.array, mv = new Uint8Array(nV); let c = 0;
    for (let v = 0; v < nV; v++) { const o = v * 3; if (d[o] === 0 && d[o + 1] === 0 && d[o + 2] === 0) continue; X[o] += d[o]; X[o + 1] += d[o + 1]; X[o + 2] += d[o + 2]; mv[v] = 1; c++; }
    renormal(G, mv); G.attributes.position.needsUpdate = true; G.computeBoundingSphere?.(); byLen.set(d.length, d); report.push({ level: lvl(G), verts: nV, moved: c }); }
  return { byLen, report };
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
