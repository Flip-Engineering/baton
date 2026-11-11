// FACE7 c7 it 19 (15 Oct): THE EYE'S CAVITY. The skin round the eye lit by what it can see of the room.
//
// What the photographs show and the engine did not: along both lid margins a continuous dark line 0.5-1 mm thick, the lid's shadow over
// the top of the iris, the skin under a dense brow darker than the skin round it. These are not pigment and not make-up: they are the
// eye's CAVITY. The upper lid's free margin (~2 mm across, its posterior edge resting on the globe in the tear film) faces DOWN onto the
// eye; the fold's underside faces down onto the tarsal platform; the lash rows stand in front of both; the brow's hairs lie over the brow's
// skin. Each of those surfaces sees the room through a narrow window: the globe, the other lid, the fold and the hairs fill most of its
// hemisphere. In a path tracer (Cycles) that comes free; the engine lights skin with the stage's environment (the studio's: a bright paper
// floor and a fill card near the lens, dim above) times SKIN's ambient occlusion, which is a PROXY: how far a vertex sits under a smoothed
// copy of the body's own surface (likeness/skin.js skinFields). The proxy cannot see the eye (a separate mesh), nor the hairs, and it calls
// a margin's convex edge open: so the down-facing margin and the fold's underside took the floor's bounce and the fill in full and read as
// a pale band (the critics' 'cream frost' behind the lashes; FACE7 it 18's probe: N.L ~ 0 to the key over 4.6-5.1 mm and 5.9-7.3 mm above
// the eye's centre at the pupil, so that band is lit by the environment alone).
//
// So here the VISIBILITY itself: for every vertex of the skin round each eye (the lids, the canthi, the brow, the upper cheek), `rays`
// cosine-weighted directions over the vertex's hemisphere are cast against the geometry that is drawn: the skin (the lids as lidTissue
// built them, the nose, the brow ridge, the cheek), the eye (eye7's globe and corneal cap, its tear meniscus and caruncle) and the hair
// cards in front of the skin, each card a thin slab that lets through 1 - its hairs' coverage where the ray crosses it (the lash and brow
// cards' own hairs at their calibre: hair/brow7.js strandsGLSL's expected cover, n x strand x the natural point / the card's narrowing;
// a card without that record: its atlas tile's coverage at the hit). V = the mean over the rays of (0 if an opaque surface is met within
// `reach` mm, else the product of the cards' transmittances): the cosine-weighted share of the room the point sees. Nothing is fitted:
// no colour, no tint, no target; V holds for any person the system makes and any stage (it is the geometry's, not a light's).
// Where V is computed it REPLACES the proxy in SKIN's ambient-occlusion slot (aLikeA.y), blended out over `fade` mm at the region's edge,
// and in that region the slot is applied in full (the proxy's 60 % / 75 % strengths in likeness/skin.js AO are for a proxy; a measured
// visibility multiplies the environment's irradiance as it is): face7Skin patches the two lines of the body's AO chunk (cavityPatch).
// Engine only: Cycles traces the same geometry (person_scene / person_hair draw the lids, the eye and the hairs), so it has no use for V
// and the export's aLikeA is not read there. Not modelled (said plainly): the direct key's sub-mm shadows stay the shadow map's (the
// cards cast with their atlas tile); the scalp's hair cards (a fringe over the brow) are not occluders here; the expression morphs at
// rest are ignored (V from the bind pose); the eye itself (eye7's sclera and iris) keeps EYES' own occlusion shell (the lash rows' cover
// on it is EYES' to take: lashRowCover below gives it per direction).
//   face7Cavity(h, o, U) -> report     (after buildEyes: likeness/eyes.js runs it through h.face7.cavityRun)
//   cavityPatch(mat, U, rep)           (face7Skin: the body material's AO lines; U the uniforms face7Cavity fills)
import * as THREE from 'three';

export const CAVITY7 = {
  rays: 128,     // cosine-weighted directions a vertex (a fixed Hammersley set, turned per vertex)
  reach: 40,     // mm: what lies further than this is the room's (the stage's screen-space AO carries the cm-to-dm scale)
  lift: 0.04,    // mm: the ray's origin off the surface (along the vertex normal), and the nearest hit counted
  cell: 2.0,     // mm: the occluders' grid
  // mm round each eye's centre (lat: toward the temple, med: toward the nose): where V is computed; it fades out over `fade`
  box: { med: 28, lat: 32, up: 34, down: 20, back: 12, fade: 4 },
  // mm: what may occlude (the nose, the brow ridge, the cheek)
  occ: { med: 46, lat: 44, up: 46, down: 40, back: 26 },
};

const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// the region's weight at (lat, dy, dz) mm from an eye's centre (lat = dx x side: + toward the temple); the GLSL below is the same function
export function cavityWeight(lat, dy, dz, b) {
  return sst(-b.med, -b.med + b.fade, lat) * sst(b.lat, b.lat - b.fade, lat) * sst(-b.down, -b.down + b.fade, dy) * sst(b.up, b.up - b.fade, dy) * sst(-b.back, -b.back + b.fade, dz);
}
const GLSL = `
uniform vec4 f7CavC0, f7CavC1, f7CavB, f7CavF;   // (FACE7 cavity7) the eyes' centres (bind m) + side; the box med, lat, up, down (m); back, fade (m), on
float f7SS(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float f7CavW1(vec3 p, vec4 c) { vec3 d = p - c.xyz; float lat = d.x * c.w;
  return f7SS(-f7CavB.x, -f7CavB.x + f7CavF.y, lat) * f7SS(f7CavB.y, f7CavB.y - f7CavF.y, lat) * f7SS(-f7CavB.w, -f7CavB.w + f7CavF.y, d.y)
    * f7SS(f7CavB.z, f7CavB.z - f7CavF.y, d.y) * f7SS(-f7CavF.x, -f7CavF.x + f7CavF.y, d.z); }
float f7CavW(vec3 p) { return f7CavF.z > 0.5 ? max(f7CavW1(p, f7CavC0), f7CavW1(p, f7CavC1)) : 0.0; }
`;
// the two lines of SKIN's AO chunk (likeness/skin.js AO, in rev 6 / 7's AO6 too) where the slot's strength is set for its proxy
const A_SPEC = 'a = mix(1.0, likeAO, 0.75);', A_DIFF = 'reflectedLight.indirectDiffuse *= mix(1.0, likeAO, 0.6);';
export function cavityUniforms() {
  return { f7CavC0: { value: new THREE.Vector4() }, f7CavC1: { value: new THREE.Vector4() }, f7CavB: { value: new THREE.Vector4() }, f7CavF: { value: new THREE.Vector4() } };
}
export function cavityPatch(mat, U, rep = {}) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); const fs = sh.fragmentShader;
    rep.cavityPatch = { spec: fs.includes(A_SPEC), diff: fs.includes(A_DIFF), vBind: /varying vec3 vBind/.test(fs) };
    if (!rep.cavityPatch.diff || !rep.cavityPatch.vBind) return;
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = fs.replace('#include <common>', '#include <common>\n' + GLSL)
      .replace(A_SPEC, 'a = mix(mix(1.0, likeAO, 0.75), likeAO, f7CavW(vBind));')
      .replace(A_DIFF, 'reflectedLight.indirectDiffuse *= mix(mix(1.0, likeAO, 0.6), likeAO, f7CavW(vBind));'); };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|f7cav'; mat.needsUpdate = true;
  return rep;
}

// the expected share of a hair card's width its hairs cover at t (0 root .. 1 tip): hair/brow7.js strandsGLSL's hairs averaged over their
// draws (each ends at 0.85-1.0 of the card, keeps its calibre as the card narrows by conv, the natural point over the last `tip` to k)
export function cardCover(q, t) {
  if (!(t >= 0 && t <= 1)) return 0;
  const wRel = 1 + (q.conv - 1) * Math.pow(t, 1.1), alive = t < 0.85 ? 1 : Math.max(0, (1 - t) / 0.15), tt = Math.min(1, t / 0.925);
  const pt = 1 - (1 - q.k) * sst(1 - q.tip, 1, tt);
  return Math.min(1, Math.max(1, q.n | 0) * q.strand * pt / wRel * alive);
}

// a fixed cosine-weighted set (Hammersley; Malley's method): unit (x, y, z) with z the normal's share
function hemiSet(n) { const D = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { let b = i, r = 0, f = 0.5; while (b) { if (b & 1) r += f; b >>= 1; f *= 0.5; }
    const u = (i + 0.5) / n, phi = 2 * Math.PI * r, s = Math.sqrt(u); D[i * 3] = s * Math.cos(phi); D[i * 3 + 1] = s * Math.sin(phi); D[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - u)); }
  return D; }

// the occluders round one eye (mm, the eye's frame: x, y, z from its centre in bind): triangles (v0, e1, e2), kind (0 opaque, 1 card), per
// card triangle its vertices' t along the card and its record (q: strands; or the atlas: tile image + gain + its uv)
function gather(meshes, c, O) {
  const T = [], K = [], TC = [], Q = [], UV = [], M = []; let mi = -1;
  const inOcc = (x, y, z, side) => { const lat = x * side; return lat > -O.occ.med && lat < O.occ.lat && y > -O.occ.down && y < O.occ.up && z > -O.occ.back; };
  for (const [m, kind, q] of meshes) { mi++; const g = m.geometry, p = g.attributes.position.array, ix = g.index ? g.index.array : null, nt = ix ? ix.length : p.length / 3, uv = g.attributes.uv?.array;
    for (let t = 0; t < nt; t += 3) { const a = ix ? ix[t] : t, b = ix ? ix[t + 1] : t + 1, d = ix ? ix[t + 2] : t + 2;
      const ax = (p[a * 3] - c.x) * 1000, ay = (p[a * 3 + 1] - c.y) * 1000, az = (p[a * 3 + 2] - c.z) * 1000;
      const bx = (p[b * 3] - c.x) * 1000, by = (p[b * 3 + 1] - c.y) * 1000, bz = (p[b * 3 + 2] - c.z) * 1000;
      const dx = (p[d * 3] - c.x) * 1000, dy = (p[d * 3 + 1] - c.y) * 1000, dz = (p[d * 3 + 2] - c.z) * 1000;
      if (!inOcc((ax + bx + dx) / 3, (ay + by + dy) / 3, (az + bz + dz) / 3, c.side)) continue;
      if (Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz), Math.abs(ax - dx), Math.abs(ay - dy), Math.abs(az - dz)) > 25) continue;
      T.push(ax, ay, az, bx - ax, by - ay, bz - az, dx - ax, dy - ay, dz - az); K.push(kind); M.push(mi);
      if (kind === 1 && uv) { const v0 = uv[a * 2 + 1], v1 = uv[b * 2 + 1], v2 = uv[d * 2 + 1], base = Math.floor(Math.min(v0, v1, v2) + 1e-6);
        TC.push(v0 - base, v1 - base, v2 - base); Q.push(q); UV.push(uv[a * 2], uv[b * 2], uv[d * 2]); }
      else { TC.push(0, 0, 0); Q.push(null); UV.push(0, 0, 0); } } }
  return { T: Float64Array.from(T), K: Uint8Array.from(K), TC: Float32Array.from(TC), Q, UV: Float32Array.from(UV), M: Uint16Array.from(M), n: K.length };
}
// a uniform grid over the triangles' boxes (CSR)
function grid(G, cell) {
  const { T, n } = G; let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  if (!n) return Object.assign(G, { x0: 0, y0: 0, z0: 0, nx: 1, ny: 1, nz: 1, cell, start: new Uint32Array(2), idx: new Uint32Array(0), stamp: new Uint32Array(0), ray: 0 });
  const box = i => { const o = i * 9, ax = T[o], ay = T[o + 1], az = T[o + 2], bx = ax + T[o + 3], by = ay + T[o + 4], bz = az + T[o + 5], cx = ax + T[o + 6], cy = ay + T[o + 7], cz = az + T[o + 8];
    return [Math.min(ax, bx, cx), Math.min(ay, by, cy), Math.min(az, bz, cz), Math.max(ax, bx, cx), Math.max(ay, by, cy), Math.max(az, bz, cz)]; };
  for (let i = 0; i < n; i++) { const b = box(i); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]); x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]); }
  x0 -= 0.01; y0 -= 0.01; z0 -= 0.01;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell + 1e-6)), ny = Math.max(1, Math.ceil((y1 - y0) / cell + 1e-6)), nz = Math.max(1, Math.ceil((z1 - z0) / cell + 1e-6));
  const cl = (v, lo, m) => Math.min(m - 1, Math.max(0, Math.floor((v - lo) / cell)));
  const span = i => { const b = box(i); return [cl(b[0], x0, nx), cl(b[3], x0, nx), cl(b[1], y0, ny), cl(b[4], y0, ny), cl(b[2], z0, nz), cl(b[5], z0, nz)]; };
  const st = new Uint32Array(nx * ny * nz + 1); for (let i = 0; i < n; i++) { const s = span(i); for (let k = s[4]; k <= s[5]; k++) for (let j = s[2]; j <= s[3]; j++) for (let q = s[0]; q <= s[1]; q++) st[(k * ny + j) * nx + q + 1]++; }
  for (let i = 1; i < st.length; i++) st[i] += st[i - 1];
  const idx = new Uint32Array(st[st.length - 1]), fill = st.slice(0, -1);
  for (let i = 0; i < n; i++) { const s = span(i); for (let k = s[4]; k <= s[5]; k++) for (let j = s[2]; j <= s[3]; j++) for (let q = s[0]; q <= s[1]; q++) idx[fill[(k * ny + j) * nx + q]++] = i; }
  Object.assign(G, { x0, y0, z0, nx, ny, nz, cell, start: st, idx, stamp: new Uint32Array(n), ray: 0 });
  return G;
}
// the atlas tile's coverage at uv (a card with no strands record): its green channel x the card material's alpha gain
function atlasCover(q, u, v) { const img = q.img, W = img.width, H = img.height, x = Math.min(W - 1, Math.max(0, Math.floor(u * W))), y = Math.min(H - 1, Math.max(0, Math.floor((v - Math.floor(v)) * H)));
  return Math.min(1, img.data[(y * W + x) * 4 + 1] / 255 * q.gain); }
// one ray: 0 if an opaque triangle lies within (tmin, tmax), else the product of the card slabs' (1 - cover) it crosses
function trace(G, ox, oy, oz, dx, dy, dz, tmin, tmax) {
  const { T, K, TC, Q, UV, M, x0, y0, z0, nx, ny, nz, cell, start, idx, stamp } = G; const ray = ++G.ray;
  let ix = Math.floor((ox - x0) / cell), iy = Math.floor((oy - y0) / cell), iz = Math.floor((oz - z0) / cell);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return 1;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(cell / dx) : 1e30, tdy = dy !== 0 ? Math.abs(cell / dy) : 1e30, tdz = dz !== 0 ? Math.abs(cell / dz) : 1e30;
  let tx = dx !== 0 ? ((x0 + (ix + (dx > 0 ? 1 : 0)) * cell) - ox) / dx : 1e30, ty = dy !== 0 ? ((y0 + (iy + (dy > 0 ? 1 : 0)) * cell) - oy) / dy : 1e30, tz = dz !== 0 ? ((z0 + (iz + (dz > 0 ? 1 : 0)) * cell) - oz) / dz : 1e30;
  let trans = 1, tEnter = 0;
  while (tEnter <= tmax) {
    const c = (iz * ny + iy) * nx + ix;
    for (let k = start[c], e = start[c + 1]; k < e; k++) { const i = idx[k]; if (stamp[i] === ray) continue; stamp[i] = ray;
      const o = i * 9, e1x = T[o + 3], e1y = T[o + 4], e1z = T[o + 5], e2x = T[o + 6], e2y = T[o + 7], e2z = T[o + 8];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue; const inv = 1 / det, qx0 = ox - T[o], qy0 = oy - T[o + 1], qz0 = oz - T[o + 2];
      const u = (qx0 * px + qy0 * py + qz0 * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = qy0 * e1z - qz0 * e1y, qy = qz0 * e1x - qx0 * e1z, qz = qx0 * e1y - qy0 * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t <= tmin || t > tmax) continue;
      if (G.log) G.log.push([M[i], +t.toFixed(3), K[i]]);
      if (K[i] === 0 && !G.log) return 0; if (K[i] === 0) { G.hitOpaque = true; continue; }
      const w = 1 - u - v, q = Q[i]; let cov;
      if (q && q.n) cov = cardCover(q, w * TC[i * 3] + u * TC[i * 3 + 1] + v * TC[i * 3 + 2]);
      else if (q && q.img) cov = atlasCover(q, w * UV[i * 3] + u * UV[i * 3 + 1] + v * UV[i * 3 + 2], w * TC[i * 3] + u * TC[i * 3 + 1] + v * TC[i * 3 + 2]);
      else cov = 0;
      trans *= 1 - cov; if (trans < 1e-3) return 0; }
    if (tx < ty && tx < tz) { tEnter = tx; tx += tdx; ix += sx; if (ix < 0 || ix >= nx) break; }
    else if (ty < tz) { tEnter = ty; ty += tdy; iy += sy; if (iy < 0 || iy >= ny) break; }
    else { tEnter = tz; tz += tdz; iz += sz; if (iz < 0 || iz >= nz) break; }
  }
  return trans;
}
// a card mesh's record: hair/brow7.js patchStrands writes the hairs' numbers on the material (userData.strands7); else its atlas tile
function cardRecord(m) { const s = m.material?.userData?.strands7; if (s && s.n) return { n: s.n, strand: s.strand, conv: s.conv ?? 1, tip: s.tip ?? 0.35, k: s.k ?? 0.25 };
  const U = m.material?.userData?.hairU, img = U?.hAtlas?.value?.image; return img?.data ? { img, gain: U.hMisc?.value?.x ?? 1 } : null; }

export function face7Cavity(h, o = {}, U = null) {
  const t0 = Date.now(), O = { ...CAVITY7, ...o, box: { ...CAVITY7.box, ...(o.box || {}) }, occ: { ...CAVITY7.occ, ...(o.occ || {}) } };
  const eyes = h.likeness?.eyes?.eyes, g = h.body?.geometry, A = g?.attributes?.aLikeA;
  if (!eyes?.length || !A) return { skipped: !eyes?.length ? 'no eyes' : 'no aLikeA (no skin)' };
  const P = g.attributes.position.array, N = g.attributes.normal?.array || h.nrm, n = P.length / 3;
  const meshes = [[h.body, 0, null]];
  h.group.traverse(m => { if (!m.isMesh || m === h.body || m.visible === false) return; const part = m.userData?.part, hp = m.userData?.hairPart;
    if (part === 'eye' || part === 'eye-meniscus' || part === 'eye-caruncle') meshes.push([m, 0, null]);
    else if (hp === 'lashes' || hp === 'lashesLow' || hp === 'brows') meshes.push([m, 1, cardRecord(m)]); });
  // the proxy's values, kept the first time (a rebuild of the eyes recomputes from them)
  const A0 = h.face7?.cavityA0 || (h.face7 ? (h.face7.cavityA0 = Float32Array.from({ length: n }, (_, v) => A.array[v * 4 + 1])) : Float32Array.from({ length: n }, (_, v) => A.array[v * 4 + 1]));
  const D = hemiSet(O.rays), rep = { rays: O.rays, reach: O.reach, eyes: {}, occluders: meshes.map(([m, k, q]) => (m.userData?.hairPart || m.userData?.part || 'mesh') + (k ? (q?.n ? ':strands' : q?.img ? ':atlas' : ':none') : '')) };
  for (const e of eyes) {
    const c = { x: e.c.x, y: e.c.y, z: e.c.z, side: e.side > 0 ? 1 : -1 }, s = c.side > 0 ? 'L' : 'R', te = Date.now();
    const G = grid(gather(meshes, c, O), O.cell);
    let nv = 0, sumV = 0, sumA = 0; const col = [];
    for (let v = 0; v < n; v++) {
      const x = (P[v * 3] - c.x) * 1000, y = (P[v * 3 + 1] - c.y) * 1000, z = (P[v * 3 + 2] - c.z) * 1000, w = cavityWeight(x * c.side, y, z, O.box);
      if (w <= 0) continue;
      let nxv = N[v * 3], nyv = N[v * 3 + 1], nzv = N[v * 3 + 2]; const nl = Math.hypot(nxv, nyv, nzv) || 1; nxv /= nl; nyv /= nl; nzv /= nl;
      // the tangent frame, turned per vertex (a hash of the index) so the fixed set does not band
      let tx = Math.abs(nxv) < 0.9 ? 0 : 1, ty = Math.abs(nxv) < 0.9 ? 1 : 0, tz = 0; { const d = tx * nxv + ty * nyv; tx -= d * nxv; ty -= d * nyv; tz -= d * nzv; const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l; }
      const bx = nyv * tz - nzv * ty, by = nzv * tx - nxv * tz, bz = nxv * ty - nyv * tx, ang = ((Math.sin(v * 12.9898) * 43758.5453) % 1) * 2 * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
      const ox = x + nxv * O.lift, oy = y + nyv * O.lift, oz = z + nzv * O.lift; let acc = 0;
      for (let r = 0; r < O.rays; r++) { const a = D[r * 3] * ca - D[r * 3 + 1] * sa, b = D[r * 3] * sa + D[r * 3 + 1] * ca, cz = D[r * 3 + 2];
        acc += trace(G, ox, oy, oz, a * tx + b * bx + cz * nxv, a * ty + b * by + cz * nyv, a * tz + b * bz + cz * nzv, O.lift, O.reach); }
      const V = acc / O.rays, a0 = A0[v]; A.array[v * 4 + 1] = a0 * (1 - w) + V * w; nv++; sumV += V; sumA += a0;
      if (Math.abs(x) < 0.8 && nzv > 0.05 && y > -14 && y < 26) col.push([+y.toFixed(2), +V.toFixed(3), +a0.toFixed(3), +z.toFixed(2)]);
    }
    col.sort((p, q) => q[0] - p[0]);
    rep.eyes[s] = { verts: nv, tris: G.n, meanV: +(sumV / Math.max(1, nv)).toFixed(3), meanProxy: +(sumA / Math.max(1, nv)).toFixed(3), ms: Date.now() - te, column: col };
    if (U) U['f7CavC' + (c.side > 0 ? 0 : 1)].value.set(c.x, c.y, c.z, c.side);
  }
  A.needsUpdate = true;
  if (U) { const b = O.box; U.f7CavB.value.set(b.med / 1000, b.lat / 1000, b.up / 1000, b.down / 1000); U.f7CavF.value.set(b.back / 1000, b.fade / 1000, 1, 0); }
  rep.ms = Date.now() - t0;
  return rep;
}

// for EYES (the lash rows' cover on the eye: eye7's occlusion shell has the lids, not the hairs): the transmittance of the hair cards from a
// point p (bind m) along a unit direction d, within reach mm; build once per eye with lashRowCover(h, e), then .T(p, d)
export function lashRowCover(h, e, o = {}) {
  const O = { ...CAVITY7, ...o, occ: { ...CAVITY7.occ, ...(o.occ || {}) } }, c = { x: e.c.x, y: e.c.y, z: e.c.z, side: e.side > 0 ? 1 : -1 }, meshes = [];
  h.group.traverse(m => { const hp = m.userData?.hairPart; if (m.isMesh && (hp === 'lashes' || hp === 'lashesLow' || hp === 'brows')) meshes.push([m, 1, cardRecord(m)]); });
  const G = grid(gather(meshes, c, O), O.cell);
  return { T: (p, d) => G.n ? trace(G, (p[0] - c.x) * 1000, (p[1] - c.y) * 1000, (p[2] - c.z) * 1000, d[0], d[1], d[2], 0, O.reach) : 1, cards: G.n };
}
// (for probes) the pieces, to look at one vertex's rays
export const _cavity7 = { gather, grid, trace, hemiSet, cardRecord };
