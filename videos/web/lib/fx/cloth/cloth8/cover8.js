// CLOTH8 c2 (round 7, 8 Oct): SHRINK, DON'T DROP. The skin a dressed person's clothes cover is KEPT and pushed INWARD, in place of the cull.
// THE CAUSE (the orchestrator's 08:04 PRIORITY; gpu_cycles/defects/DEFECTS.md: black voids at collars, elbows, cuffs, hems on every v6
// Cycles render): person/v2.js cullBody2 LEAVES OUT of the body's index every triangle the bake's cull list calls covered (bake.cullFull,
// dressed), in the engine and therefore in the export (export.js writes the culled index: a v6 work export's atlas 1 has 45k triangles
// where the bare one has 69k) and in the skin bake. So wherever a garment stands off the body, crumples or opens, the eye looks through the
// opening into an EMPTY SHELL (the garment's own inside, unlit): black. (videos/blender/person_scene.py's drop by the skin_cover mask is the
// same idea on the older path where the dressed and bare unwraps match; blender/cover8.py is its twin there.) Real garments show skin, in
// shadow, in a gap.
// THE FIX: the full index back (the subdivision plan's own triangle list, of which the culled index is an ordered subset), and every vertex
// that only culled triangles use pushed in along its bind normal by d, feathered from 0 at the cull's edge (the vertices a drawn triangle
// shares) to d over `feather` of surface distance. The cull's reason (no skin through tight cloth) is kept: the skin now lies d under where
// it was; the garments are untouched (this runs after everything that reads the body: the settle's collider, the lift, the ride).
// Opt-in: export.js buildPerson runs it when makePerson's options carry `cover8` (true or { d, feather, ease }) and the person is dressed:
// the Cycles export (person_job.py --popts '{"cover8": {...}}') and lab_bake's skin bake both come through there, so they agree; a page
// (the engine twin) calls applyCover8(P, opts) after makePerson. Absent: nothing runs. No hero.js edit, no shader, no vertex attribute
// (positions and the index only), so the 16-attribute limit is untouched.
// REV 2 (c2 it2, 8 Oct, opt-in `clear`): THE PUSH DEEP ENOUGH WHERE THE CLOTH HUGS. The measurer's it1 read (measures/it1.md): two skin
// specks through cloth creases (L03's shirt dart, L21's sweatshirt dent), where the cloth lies within the 4 mm push of the restored skin or
// INSIDE it (a crease dipping under the old skin surface: the cull hid that). With `clear` (metres, e.g. 0.006) each restored vertex is
// pushed by depth = clamp(clear - s, d, dMax), s = the signed height of the innermost cloth over the POSED skin along its POSED normal
// (a segment +-reach through the vertex along its skinned bind normal, the push's own direction, against every drawn garment triangle:
// the body as the export and the page pose it): the nearest cloth OUTSIDE the skin (what covers it), or, where there is none, the nearest
// cloth under it (negative: the skin lies outside every cloth there, the solver's cloth inside the body; the skin must go under it), the requirement spread to the neighbours (`spread` rounds of max(own, mean of ring): a soft dilation, so
// one deep vertex makes a smooth dimple, not a spike) and feathered at the cull's edge over `featherClear` (the base d keeps `feather`).
// Where the cloth lies deeper under the skin than dMax - clear (the solver's cloth inside the body: mostly trouser legs and the crotch),
// `keepCut` (default) leaves those culled triangles out as v6 did: there the skin would cover the cloth. The report gives the restored
// vertices whose gap after the push (s + push) is under 2 mm, rev-1 depth | this one ('tightBefore', 'tightAfter', by cloth and cause).
// (c3 it1, 8 Oct: rev 1, the fixed push without `clear`, is DELETED: the clearance always runs; git history has rev 1.)
// (c8 it1, 15 Oct: REV 3 IS THE ONLY PATH. The review gate is abolished; of two arms the one the simulation produces is kept: contact8, a
// cloth solve, now keeps every garment outside the drawn skin as cover8's last step, so the skin no longer chases cloth lying inside the
// body (rev 2's `under` chase sank the skin up to 12 mm and the solved cloth with it, a garment shrunk into its body) and no triangle is
// culled again (`keepCut`: with no chase it could never trigger). Rev 2's vertex-normal direction, its chase and keepCut and the `rev`
// switch are DELETED; git history has them.)
// REV 3 (c2 it3, 8 Oct): THE SPECKS WERE A
// FOLDED PATCH OF THE BODY, NOT THE CLOTH. The measurer's it2 G3: the two chest specks grew 7-9x with rev 2 and were identical on v8c. Found
// (labs/clothing2/cloth8/speck_probe.mjs, camera rays from the export's own shot camera): both sit exactly on hm08's fixed nipple vertex (L21
// 1799 at bust px 684,706; L03 1799 at 495,744), whose patch (~50 restored vertices) is turned INSIDE OUT in the v6 body (the 'star crumple'
// BODY7's NAC7 replaced in v7): its face and vertex normals point INTO the body (dot with the smoothed surface normal -0.98..-1), so 'in along
// the normal' pushed it OUT through the shirt (rev 1 by 4 mm, rev 2 by up to 12 mm: rev 2 measured the cloth along the same inverted
// normal, found it 'under' and chased it). Rev 3: (1) the push follows the bind surface's SMOOTHED outward normal (area-weighted face normals of
// the full triangle list averaged over 8 rings: a folded patch is outvoted by the surface round it), the clearance is measured along it too;
// (2) only cloth OUTSIDE the skin sets the extra depth (`under: false`: rev 2's chase of cloth lying inside the body pushed the waist above
// L21's jeans 12 mm in and lost its fill; the crotch and thighs, where the trousers lie inside the body, are not cover8's to fix);
// (3) no `keepCut` (it lost L21's hem wedge and arm-torso fills and did not stop the crotch pokes). Measured by speck_probe --scan (restored
// skin with no cloth in front of it from the camera but cloth within 2 cm behind it: skin through its own cloth): L21 bust 86 (rev 1) / 115
// (rev 2) -> 13, L03 bust 207 / 240 -> 118 (the speck clusters 68 and 88 -> 0; what is left is the open collar and cuff gaps), the hem
// wedge kept (7 gap samples as rev 1).
import * as THREE from 'three';
import { contactPerson8 } from './contact8.js';

export const COVER8_VERSION = 3;
export const COVER8_DEFAULT = { d: 0.004, feather: 0.02, ease: 'out', dirRings: 8 };
// the clearance: only cloth OUTSIDE the skin sets the extra depth (rev 3; the header)
export const COVER8_CLEAR = { clear: 0.006, dMax: 0.012, reach: 0.015, spread: 3, featherClear: 0.006, tight: 0.002 };
// the bind surface's smoothed outward normal per vertex: area-weighted face normals of the FULL triangle list (culled ones too), averaged
// over `rings` rings of the mesh's own edges (a folded patch of a few rings is outvoted by the surface round it)
export function smoothNormals8(X, tri, n, rings = 8) {
  let A = new Float64Array(n * 3); const deg = new Int32Array(n + 1);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { A[o] += nx; A[o + 1] += ny; A[o + 2] += nz; }
    deg[tri[t]] += 2; deg[tri[t + 1]] += 2; deg[tri[t + 2]] += 2; }
  const off = new Int32Array(n + 1); for (let v = 0; v < n; v++) off[v + 1] = off[v] + deg[v]; const adj = new Int32Array(off[n]), fill = off.slice(0, n);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; adj[fill[a]++] = b; adj[fill[a]++] = c; adj[fill[b]++] = a; adj[fill[b]++] = c; adj[fill[c]++] = a; adj[fill[c]++] = b; }
  for (let r = 0; r < rings; r++) { const B = Float64Array.from(A);
    for (let v = 0; v < n; v++) for (let k = off[v]; k < off[v + 1]; k++) { const w = adj[k] * 3; B[v * 3] += A[w]; B[v * 3 + 1] += A[w + 1]; B[v * 3 + 2] += A[w + 2]; }
    for (let i = 0; i < B.length; i++) A[i] = B[i] * 0.25; }   // scaled down each round (the direction is what is kept)
  const S = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) { const l = Math.hypot(A[v * 3], A[v * 3 + 1], A[v * 3 + 2]); if (l > 0) { S[v * 3] = A[v * 3] / l; S[v * 3 + 1] = A[v * 3 + 1] / l; S[v * 3 + 2] = A[v * 3 + 2] / l; } }
  return S;
}

const ease = (t, k) => k === 'linear' ? t : k === 'smooth' ? t * t * (3 - 2 * t) : t * (2 - t);

// (c7 it1) THE LAST WORD: after the skin under the clothes is restored and pushed, contact8 (contact8.js contactPerson8) keeps every
// garment vertex outside that final skin, signed by its smoothed normal; this is the last geometric step on the garments in the engine
// build and in the Cycles export (export.js runs applyCover8 after CORRECT5's corrected bind). `contact8: false` in the options is the A/B.
export function applyCover8(P, o = {}) {
  const rep = cover8Body(P, o), c = o && typeof o === 'object' ? o.contact8 : undefined;
  if (c !== false && P.parts?.length) { try { rep.contact8 = contactPerson8(P, c); } catch (e) { rep.contact8 = { error: String(e.message || e) }; } }
  return rep;
}

// P = makePerson's result; o = true or { d, feather, ease } (metres). -> a report ({ skipped } when nothing could be done)
function cover8Body(P, o = {}) {
  const h = P.h || P, g = h.body?.geometry; if (!g) return { skipped: 'no body' };
  const opt = { ...COVER8_DEFAULT, ...(o && typeof o === 'object' ? o : {}) }, sc = h.scale || 1, t0 = (globalThis.performance || Date).now();
  const plan = g.userData.plan, full = plan?.tri;
  if (!full || !g.index) return { skipped: 'no subdivision plan: the full triangle list is not known' };
  const cur = g.index.array; if (cur.length === full.length) return { skipped: 'nothing culled' };
  if (cur.length > full.length) return { skipped: 'the index is longer than the plan\'s' };
  // the culled triangles: the drawn index is the plan's with triangles left out, in order (cullBody2)
  const nt = full.length / 3, cut = new Uint8Array(nt); let j = 0;
  for (let t = 0; t < nt; t++) { if (j < cur.length && cur[j] === full[t * 3] && cur[j + 1] === full[t * 3 + 1] && cur[j + 2] === full[t * 3 + 2]) j += 3; else cut[t] = 1; }
  if (j !== cur.length) return { skipped: 'the drawn index is not an ordered subset of the plan\'s' };
  const pa = g.attributes.position, na = g.attributes.normal, X = pa.array, N = na.array, n = pa.count;
  const drawn = new Uint8Array(n), hid = new Uint8Array(n);
  for (let t = 0; t < nt; t++) { const f = cut[t] ? hid : drawn; f[full[t * 3]] = 1; f[full[t * 3 + 1]] = 1; f[full[t * 3 + 2]] = 1; }
  // surface distance (over the culled triangles' edges, in metres) from the cull's edge, capped at the feather (Bellman-Ford rounds)
  const F = Math.max(1e-6, +opt.feather), dist = new Float64Array(n).fill(F), E = [];
  for (let v = 0; v < n; v++) if (hid[v] && drawn[v]) dist[v] = 0;
  for (let t = 0; t < nt; t++) if (cut[t]) for (let k = 0; k < 3; k++) { const a = full[t * 3 + k], b = full[t * 3 + (k + 1) % 3]; E.push(a, b, Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]) * sc); }
  let rounds = 0;
  for (; rounds < 2000; rounds++) { let ch = 0;
    for (let e = 0; e < E.length; e += 3) { const a = E[e], b = E[e + 1], L = E[e + 2];
      if (dist[a] + L < dist[b]) { dist[b] = dist[a] + L; ch++; } else if (dist[b] + L < dist[a]) { dist[a] = dist[b] + L; ch++; } }
    if (!ch) break; }
  // rev 3: the push's direction is the bind surface's SMOOTHED outward normal, not the vertex's own normal (on a folded patch, e.g. hm08's
  // crumpled nipple patch, the own normal points INTO the body and the push came out through the cloth)
  let inverted = 0; const SN = smoothNormals8(X, full, n, opt.dirRings);
  for (let v = 0; v < n; v++) if (hid[v] && !drawn[v] && N[v * 3] * SN[v * 3] + N[v * 3 + 1] * SN[v * 3 + 1] + N[v * 3 + 2] * SN[v * 3 + 2] < 0) inverted++;
  // the depth each restored vertex needs (metres; 0 = the base d is enough), from the posed cloth OUTSIDE the posed skin
  const C = { ...COVER8_CLEAR, ...(typeof opt.clear === 'object' ? opt.clear : opt.clear ? { clear: +opt.clear } : {}), ...(opt.dMax ? { dMax: +opt.dMax } : {}) };
  const clr = clearance8(h, full, hid, drawn, C, SN), extra = new Float64Array(n);
  if (clr) { for (let v = 0; v < n; v++) if (hid[v] && !drawn[v] && clr.s[v] < 1e9) extra[v] = Math.max(0, Math.min(C.dMax, C.clear - clr.s[v]) - opt.d);
    // spread: a soft dilation over the restored skin's own edges (never below a vertex's own need)
    const nb = new Float64Array(n), cnt = new Float64Array(n);
    for (let r = 0; r < C.spread; r++) { nb.fill(0); cnt.fill(0);
      for (let e = 0; e < E.length; e += 3) { const a = E[e], b = E[e + 1]; nb[a] += extra[b]; cnt[a]++; nb[b] += extra[a]; cnt[b]++; }
      for (let v = 0; v < n; v++) if (hid[v] && !drawn[v] && cnt[v]) extra[v] = Math.max(extra[v], nb[v] / cnt[v]); } }
  // the push, in the geometry's units (metres / scale), along the smoothed bind normal; only vertices no drawn triangle uses
  const dG = +opt.d / sc; let moved = 0, full_ = 0, sum = 0, max = 0, bad = 0, tightA = 0, tightB = 0, deeper = 0, tightEdge = 0, tightDeep = 0; const tightBy = {};
  const push = new Float64Array(n);
  for (let v = 0; v < n; v++) { if (!hid[v] || drawn[v]) continue;
    const nx = SN[v * 3], ny = SN[v * 3 + 1], nz = SN[v * 3 + 2], l = Math.hypot(nx, ny, nz); if (!(l > 1e-9)) { bad++; continue; }
    const s1 = dG * ease(Math.min(1, dist[v] / F), opt.ease);
    const s = s1 + (clr ? extra[v] / sc * ease(Math.min(1, dist[v] / Math.max(1e-6, C.featherClear)), opt.ease) : 0);
    if (clr && clr.s[v] < 1e9) { if (clr.s[v] + s1 * sc < C.tight) tightA++; if (s > s1 + 1e-9) deeper++;
      if (clr.s[v] + s * sc < C.tight) { tightB++; if (dist[v] < C.featherClear) tightEdge++; else if (C.clear - clr.s[v] > C.dMax) tightDeep++; const k = clr.names[clr.hm[v]]; tightBy[k] = (tightBy[k] || 0) + 1; } }
    push[v] = s * sc; if (s <= 0) continue;
    X[v * 3] -= nx / l * s; X[v * 3 + 1] -= ny / l * s; X[v * 3 + 2] -= nz / l * s;
    moved++; sum += s * sc; max = Math.max(max, s * sc); if (s >= dG * (1 - 1e-6)) full_++; }
  pa.needsUpdate = true;
  // every culled triangle back (no re-cut: contact8 keeps the cloth outside this skin)
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(full), 1)); g.computeBoundingSphere();
  const rep = { v: COVER8_VERSION, d: +opt.d, feather: F, ease: opt.ease, trianglesBack: nt - cur.length / 3, hiddenVerts: hid.reduce((a, b, i) => a + (b && !drawn[i] ? 1 : 0), 0),
    edgeVerts: hid.reduce((a, b, i) => a + (b && drawn[i] ? 1 : 0), 0), movedVerts: moved, fullPushVerts: full_, meanMm: moved ? +(sum / moved * 1000).toFixed(3) : 0,
    maxMm: +(max * 1000).toFixed(3), noNormal: bad, rounds, dir: 'smooth', invertedNormals: inverted, ms: Math.round((globalThis.performance || Date).now() - t0),
    ...(clr ? { clear: C, measured: clr.measured, tightBefore: tightA, tightAfter: tightB, tightAfterAtEdge: tightEdge, tightAfterPastMax: tightDeep, tightAfterByCloth: tightBy, deeperVerts: deeper,
      deepPushMm: (() => { const a = []; for (let v = 0; v < n; v++) if (hid[v] && !drawn[v] && push[v] > opt.d + 1e-6) a.push(push[v]); a.sort((x, y) => x - y);
        return a.length ? [0.5, 0.9, 1].map(q => +(a[Math.min(a.length - 1, Math.floor(q * a.length))] * 1000).toFixed(2)) : null; })(), clearMs: clr.ms } : {}) };
  g.userData.cover8 = rep; g.userData.v2Culled = 0;
  return rep;
}

// rev 2's measure: for each restored vertex (hid && !drawn), s = the height of the covering cloth over the posed skin along the push's
// direction (the nearest layer outside; 1e9 where no cloth crosses the segment +-reach). Posed as three.js draws it (SkinnedMesh
// getVertexPosition, world matrices): the export writes the same. Every visible mesh but the body, hair and eyes counts as cloth.
const _p = new THREE.Vector3();
function posedArr(m) {
  const n = m.geometry.attributes.position.count, P = new Float64Array(n * 3);
  m.updateMatrixWorld(true); if (m.isSkinnedMesh) m.skeleton.update();
  for (let i = 0; i < n; i++) { m.getVertexPosition(i, _p); _p.applyMatrix4(m.matrixWorld); P[i * 3] = _p.x; P[i * 3 + 1] = _p.y; P[i * 3 + 2] = _p.z; }
  return P;
}
const visibleIn8 = m => { for (let p = m; p; p = p.parent) if (p.visible === false) return false; return true; };
export function clearance8(h, full, hid, drawn, C, dirN = null) {
  const t0 = (globalThis.performance || Date).now(), body = h.body, n = body.geometry.attributes.position.count;
  const B = posedArr(body), NB = new Float64Array(n * 3);
  // the direction of the push as posed: the bind normal skinned by its vertex's bone blend (export.js posedMesh's normal: what Cycles
  // shades, and where the bind push lands); the posed face normal disagrees by 20-80 deg in the crumpled axilla and at the neck
  const g = body.geometry, NA = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, BM = body.isSkinnedMesh ? body.skeleton.boneMatrices : null;
  const nm = new THREE.Matrix3().getNormalMatrix(body.matrixWorld), acc = new THREE.Matrix4(), nv = new THREE.Vector3();
  for (let v = 0; v < n; v++) { if (!hid[v] || drawn[v]) continue; if (dirN) nv.set(dirN[v * 3], dirN[v * 3 + 1], dirN[v * 3 + 2]); else nv.fromBufferAttribute(NA, v);
    if (BM && SI && SW) { const e = acc.elements; e.fill(0);
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(v, k); if (!w) continue; const o = SI.getComponent(v, k) * 16; for (let q = 0; q < 16; q++) e[q] += w * BM[o + q]; }
      nv.transformDirection(acc); } else nv.applyMatrix3(nm).normalize();
    NB[v * 3] = nv.x; NB[v * 3 + 1] = nv.y; NB[v * 3 + 2] = nv.z; }
  // the cloth: every drawn triangle of every visible mesh that is not the body, hair or an eye, posed, in a 1 cm hash
  const cell = 0.01, H = new Map(), T = [], TM = [], names = [];
  const key = (x, y, z) => (x + 2048) * 16777216 + (y + 2048) * 4096 + (z + 2048);
  h.group.traverse(m => { if (!m.isMesh || m === body || !visibleIn8(m) || m.userData.part === 'hair8' || /^eye/.test(m.userData.part || '')) return;
    const g = m.geometry; if (!g?.attributes?.position) return; const P = posedArr(m), I = g.index ? g.index.array : null, k = I ? I.length / 3 : P.length / 9, mi = names.length; names.push(m.userData.k3?.name || m.userData.part || m.name || 'mesh' + mi);
    for (let t = 0; t < k; t++) { const a = (I ? I[t * 3] : t * 3) * 3, b = (I ? I[t * 3 + 1] : t * 3 + 1) * 3, c = (I ? I[t * 3 + 2] : t * 3 + 2) * 3;
      const id = T.length; T.push([P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]); TM.push(mi);
      const q = T[id], x0 = Math.floor(Math.min(q[0], q[3], q[6]) / cell), x1 = Math.floor(Math.max(q[0], q[3], q[6]) / cell),
        y0 = Math.floor(Math.min(q[1], q[4], q[7]) / cell), y1 = Math.floor(Math.max(q[1], q[4], q[7]) / cell), z0 = Math.floor(Math.min(q[2], q[5], q[8]) / cell), z1 = Math.floor(Math.max(q[2], q[5], q[8]) / cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64) continue;   // a degenerate or huge triangle: not cloth near the skin
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const kk = key(x, y, z); let L = H.get(kk); if (!L) H.set(kk, L = []); L.push(id); } } });
  const s = new Float64Array(n).fill(1e9), hm = new Int32Array(n).fill(-1), seen = new Int32Array(T.length).fill(-1); let measured = 0;
  const R = C.reach, steps = Math.ceil(2 * R / (cell * 0.5));
  for (let v = 0; v < n; v++) { if (!hid[v] || drawn[v]) continue;
    const px = B[v * 3], py = B[v * 3 + 1], pz = B[v * 3 + 2]; let nx = NB[v * 3], ny = NB[v * 3 + 1], nz = NB[v * 3 + 2]; const l = Math.hypot(nx, ny, nz); if (!(l > 1e-12)) continue;
    nx /= l; ny /= l; nz /= l; let best = 1e9, mOut = -1;
    for (let st = 0; st <= steps; st++) { const u = -R + 2 * R * st / steps, L = H.get(key(Math.floor((px + nx * u) / cell), Math.floor((py + ny * u) / cell), Math.floor((pz + nz * u) / cell))); if (!L) continue;
      for (const id of L) { if (seen[id] === v) continue; seen[id] = v; const q = T[id];
        // Moller-Trumbore, the line p + t n, |t| <= R
        const e1x = q[3] - q[0], e1y = q[4] - q[1], e1z = q[5] - q[2], e2x = q[6] - q[0], e2y = q[7] - q[1], e2z = q[8] - q[2];
        const hx = ny * e2z - nz * e2y, hy = nz * e2x - nx * e2z, hz = nx * e2y - ny * e2x, det = e1x * hx + e1y * hy + e1z * hz; if (Math.abs(det) < 1e-14) continue;
        const f = 1 / det, sx = px - q[0], sy = py - q[1], sz = pz - q[2], uu = f * (sx * hx + sy * hy + sz * hz); if (uu < 0 || uu > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, vv = f * (nx * qx + ny * qy + nz * qz); if (vv < 0 || uu + vv > 1) continue;
        const t = f * (e2x * qx + e2y * qy + e2z * qz); if (t < -R || t > R) continue;
        if (t > 0 && t < best) { best = t; mOut = TM[id]; } } }
    // the cloth that covers this skin: the nearest layer outside it (cloth under the skin is contact8's: it lifts that cloth out after).
    // Deeper folds under a covering layer are hidden by it.
    if (best < 1e9) { s[v] = best; hm[v] = mOut; measured++; } }
  return { s, hm, names, measured, ms: Math.round((globalThis.performance || Date).now() - t0) };
}
