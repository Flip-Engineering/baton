// SCAN c1 (HUMAN c8, 3 Oct 2026): faces from REAL heads. A library of ten scanned people (HSRD-100, Digital Reality Lab, CC BY 4.0;
// 5 + 1 women, 4 men; 21-64; white, Black, Hispanic, Asian) registered onto OUR topology (hm08's head, jaw and neck vertices: the same
// ids as every lane A person), with each scan's skin baked into one head chart. Opt-in: nothing imports this unless it asks; a person
// nobody passes through it renders exactly as before.
//   const L = await loadScanHeads();                                     // ~0.6 MB once (assets/face/scan_heads.*)
//   const face = scanFace(L, src, { scan: 'HSR0102' });                   // src = sourceOf(person): face.js's source record
//   const face = scanFace(L, src, { scan: { HSR0102: 0.6, HSR0015: 0.4 }, averageness: 0.3, symmetry: 0.5, dimorphism: 0 });
//   const q = withFace(src, face); const h = new Hero(q, { ...opts, variant: q.variant }); fitHeroFeatures(h, face, F);
//   const S = await applySkin(h, { ...face.skin });                      // lane B; face.skin.skinHex = the scan's own skin colour
//   fitLipMask(h, face.lipsMask);                                         // FACE c2's painted vermilion on this mouth
//   await scanSkin(h, face, { detail: 1, bump: 0, albedo: 0 });          // the scan's maps through hero.js's H1 skinHook (lane B's skin first)
// CREDIT ON SCREEN: "3D scans: HSRD-100, Digital Reality Lab, CC BY 4.0" wherever a person built from these heads appears (L.credit).
//
// What a face from a scan is: the scan head's SHAPE (face, ears, the front of the neck; the scalp under hair is a learned head's, MHR's,
// fitted to the face) placed in the person's own head frame (origin between the inner canthi, x left, y up, z forward), at the person's
// own head size (opts.size: 'person', default) or the scan's ('scan'); blended into the person's neck; the eye proxies where the scan's
// eyes are. FACE c2's controls work on the library: averageness pulls toward the mean of the library's heads of the same sex (five or
// six faces: an average of few, honestly), symmetry blends with the mirrored head, dimorphism moves along the library's own
// men-minus-women mean. A blend of two or three scans is a weighted mean of their vertices (same topology, same frame).
const r1 = x => Math.round(x * 10) / 10;
let _lib = null;
export const CREDIT = '3D scans: HSRD-100, Digital Reality Lab, CC BY 4.0';
export async function loadScanHeads({ base = new URL('../../../assets/face/', import.meta.url).href, force = false } = {}) {
  if (_lib && !force) return _lib;
  const [meta, bin] = await Promise.all([fetch(base + 'scan_heads.json').then(r => r.json()), fetch(base + 'scan_heads.bin').then(r => r.arrayBuffer())]);
  return (_lib = makeScanLibrary(meta, bin, base));
}
export function makeScanLibrary(meta, bin, base = '') {
  const k = meta.k, hv = new Uint16Array(bin, meta.hv.o, k), chart = new Float32Array(bin, meta.chart.o, k * 3), blend = new Uint8Array(bin, meta.blend.o, k);
  const mirror = new Uint16Array(bin, meta.mirror.o, k), hk = meta.helpers.k;
  const helpers = { ids: new Uint16Array(bin, meta.helpers.o, hk), j: new Uint16Array(bin, meta.helpers.oj, hk * 4), w: new Float32Array(bin, meta.helpers.ow, hk * 4) };
  const heads = meta.heads.map(h => { const q = new Int16Array(bin, h.o, k * 3), qe = new Int16Array(bin, h.oe, h.ne * 3);
    return { ...h, X: Float32Array.from(q, x => x * h.q), E: Float32Array.from(qe, x => x * h.q) }; });
  const byId = Object.fromEntries(heads.map(h => [h.id, h]));
  const meanOf = list => { const X = new Float32Array(k * 3), E = new Float32Array(list[0].E.length); for (const h of list) { for (let i = 0; i < X.length; i++) X[i] += h.X[i] / list.length; for (let i = 0; i < E.length; i++) E[i] += h.E[i] / list.length; } return { X, E }; };
  const mean = { f: meanOf(heads.filter(h => h.sex === 'f')), m: meanOf(heads.filter(h => h.sex === 'm')), all: meanOf(heads) };
  return { meta, k, hv, chart, blend, mirror, helpers, heads, byId, mean, base, credit: CREDIT, provenance: meta.provenance };
}
// ---------------------------------------------------------------- a lane A body for a scanned person
// castFromScan(B, S, head) -> lane A's castBody at the scan's sex, age, group and stature, at the BMI PERCENTILE that lands the scan's
// BMI (bisection, ~6 casts). Not castBody({ bmi }): that override replaces the BMI after the NHANES draw has set waist and hip for
// another BMI (a BMI 18.8 woman came out with a 0.91 m waist; lane A, NOTES), while a percentile keeps the draw consistent.
export function castFromScan(B, S, head, { seed = 1, iters = 7 } = {}) {
  let lo = 0.005, hi = 0.995, best = null;
  for (let i = 0; i < iters; i++) { const pct = (lo + hi) / 2, p = B.castBody(S, { sex: head.sex, age: head.age, group: head.group, stature: head.height, bmiPct: pct, seed, name: `${head.id}_${head.sex}${head.age}_${head.group}` });
    const b = p.measures.bmi; if (!best || Math.abs(b - head.bmi) < Math.abs(best.measures.bmi - head.bmi)) best = p; if (b < head.bmi) lo = pct; else hi = pct; }
  return best;
}
// ---------------------------------------------------------------- the head frame (the same rule register_head.py applied to the scans)
export function headFrame(P, ids) {
  const g = k => [P[ids[k] * 3], P[ids[k] * 3 + 1], P[ids[k] * 3 + 2]], add = (a, b) => a.map((x, i) => x + b[i]), sub = (a, b) => a.map((x, i) => x - b[i]), mul = (a, s) => a.map(x => x * s);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => mul(a, 1 / Math.hypot(...a)), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const x = nrm(sub(mul(add(g('en_L'), g('ex_L')), 0.5), mul(add(g('en_R'), g('ex_R')), 0.5)));
  let y = sub(mul(add(add(g('en_L'), g('ex_L')), add(g('en_R'), g('ex_R'))), 0.25), g('sto')); y = nrm(sub(y, mul(x, dot(y, x)))); const z = cross(x, y);
  return { x, y, z, o: mul(add(g('en_L'), g('en_R')), 0.5) };
}
// size measures in a head frame (for 'person' size): the tragion breadth and the nasion-menton height
function sizeOf(P, ids, fr) { const g = k => [P[ids[k] * 3], P[ids[k] * 3 + 1], P[ids[k] * 3 + 2]], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return Math.sqrt(d(g('t_L'), g('t_R')) * d(g('n'), g('me'))); }
// ---------------------------------------------------------------- the face
// scanFace(L, src, spec) -> a face record withFace() takes. spec: scan (id | { id: weight }), averageness 0..1, symmetry 0..1,
// dimorphism -1..1, size 'person' | 'scan' | <number>, neck 0..1 (how much of the scan's neck replaces the person's), F (face studio,
// for its landmark ids; default: the ids the library was built with)
export function scanFace(L, src, spec = {}, F = null) {
  const t0 = Date.now(), ids = F?.ids || L.meta.ids || DEFAULT_IDS, k = L.k, hv = L.hv, n = src.n;
  const mix = typeof spec.scan === 'string' ? { [spec.scan]: 1 } : spec.scan || { [L.heads[0].id]: 1 };
  const ws = Object.entries(mix).filter(([id, w]) => L.byId[id] && w > 0); if (!ws.length) throw new Error('scanFace: no library head in ' + JSON.stringify(mix));
  const wsum = ws.reduce((s, [, w]) => s + w, 0), X = new Float32Array(k * 3), E = new Float32Array(L.heads[0].E.length);
  for (const [id, w] of ws) { const h = L.byId[id]; for (let i = 0; i < X.length; i++) X[i] += h.X[i] * w / wsum; for (let i = 0; i < E.length; i++) E[i] += h.E[i] * w / wsum; }
  const sexes = new Set(ws.map(([id]) => L.byId[id].sex)), sx = sexes.size === 1 ? [...sexes][0] : 'all';
  // FACE c2's controls on the library
  const av = spec.averageness ?? 0, sy = spec.symmetry ?? 0, dm = spec.dimorphism ?? 0;
  if (av) { const M = L.mean[sx]; for (let i = 0; i < X.length; i++) X[i] += av * (M.X[i] - X[i]); for (let i = 0; i < E.length; i++) E[i] += av * (M.E[i] - E[i]); }
  if (sy) { const Y = Float32Array.from(X); for (let v = 0; v < k; v++) { const m = L.mirror[v]; X[v * 3] = (1 - sy / 2) * Y[v * 3] - (sy / 2) * Y[m * 3]; X[v * 3 + 1] = (1 - sy / 2) * Y[v * 3 + 1] + (sy / 2) * Y[m * 3 + 1]; X[v * 3 + 2] = (1 - sy / 2) * Y[v * 3 + 2] + (sy / 2) * Y[m * 3 + 2]; } }
  if (dm) { const A = L.mean.m, B = L.mean.f; for (let i = 0; i < X.length; i++) X[i] += dm * 0.5 * (A.X[i] - B.X[i]); }
  // the person's head frame and size
  const P0 = src.pos, fr = headFrame(P0, ids);
  let s = 1; if (spec.size !== 'scan') { if (typeof spec.size === 'number') s = spec.size; else {
    const Xf = new Float32Array(n * 3); for (let v = 0; v < k; v++) for (let a = 0; a < 3; a++) Xf[hv[v] * 3 + a] = X[v * 3 + a];
    s = sizeOf(P0, ids, fr) / sizeOf(Xf, ids, null); } }
  const place = (x, y, z) => [fr.o[0] + s * (x * fr.x[0] + y * fr.y[0] + z * fr.z[0]), fr.o[1] + s * (x * fr.x[1] + y * fr.y[1] + z * fr.z[1]), fr.o[2] + s * (x * fr.x[2] + y * fr.y[2] + z * fr.z[2])];
  const pos = new Float32Array(P0), nk = spec.neck ?? 1, D = new Float32Array(k * 3);
  for (let v = 0; v < k; v++) { const g = hv[v], b = L.blend[v] / 255, w = b >= 0.999 ? 1 : b * nk, p = place(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]);
    for (let a = 0; a < 3; a++) { const nv = w * p[a] + (1 - w) * P0[g * 3 + a]; D[v * 3 + a] = nv - P0[g * 3 + a]; pos[g * 3 + a] = nv; } }
  // helpers (teeth, tongue ...) ride their 4 nearest head vertices
  const Hh = L.helpers; for (let i = 0; i < Hh.ids.length; i++) { const g = Hh.ids[i]; if (g >= n) continue; for (let a = 0; a < 3; a++) { let d = 0; for (let c = 0; c < 4; c++) d += Hh.w[i * 4 + c] * D[Hh.j[i * 4 + c] * 3 + a]; pos[g * 3 + a] = P0[g * 3 + a] + d; } }
  const eyes = new Float32Array(E.length); for (let i = 0; i < E.length / 3; i++) { const p = place(E[i * 3], E[i * 3 + 1], E[i * 3 + 2]); eyes[i * 3] = p[0]; eyes[i * 3 + 1] = p[1]; eyes[i * 3 + 2] = p[2]; }
  const mouth = [0, pos[ids.sto * 3 + 1], Math.max(pos[ids.ls * 3 + 2], pos[ids.li * 3 + 2])];
  const lead = L.byId[ws.sort((a, b) => b[1] - a[1])[0][0]], lp = ws.reduce((o, [id, w]) => { const l = L.byId[id].lips; o.uv += l.uv * w / wsum; o.lv += l.lv * w / wsum; o.w += l.w * w / wsum; return o; }, { uv: 0, lv: 0, w: 0 });
  const lipsMask = { halfW: s * lp.w / 2000, uv: Math.max(5, s * lp.uv) / 1000, lv: Math.max(6, s * lp.lv) / 1000 };
  return { name: src.name, rev: 'scan', ids, mouth, pos, eyes, lipsMask, spec: { scan: mix, averageness: av, symmetry: sy, dimorphism: dm, size: spec.size || 'person', neck: nk },
    scan: { mix: ws.map(([id, w]) => [id, +(w / wsum).toFixed(3)]), lead: lead.id, scale: +s.toFixed(4), frame: fr, sex: sx, people: ws.map(([id]) => { const h = L.byId[id]; return { id, sex: h.sex, age: h.age, group: h.group, bmi: h.bmi, skinHex: h.skinHex }; }) },
    skin: { skinHex: lead.skinHex, pores: 1.4, relief: 1.4, microFade: 0.5 }, credit: L.credit, ms: Date.now() - t0 };
}
// FACE P2's landmark ids (assets/face/landmarks.json) for the frame, when no face studio is passed
const DEFAULT_IDS = { en_L: 7821, ex_L: 7782, en_R: 1129, ex_R: 1090, sto: 493, ls: 466, li: 495, t_L: 12048, t_R: 5449, n: 132, me: 747 };
// ---------------------------------------------------------------- the skin: the scan's maps through hero.js's H1 skinHook
// scanSkin(h, face, { detail, bump, albedo, tex }) after lane B's applySkin. detail: how much of the scan's high-pass colour (pores,
// fine lines, freckles) multiplies lane B's albedo; bump: the scan's small forms (the 0.6-4 mm band of its surface over ours) as a
// bump on the shading normal (default 0: from LOD1 scans the band is mostly the two meshes' facets, a lumpy skin; worth it from LOD0); albedo: 0..1 how far the scan's own (delit, APPROXIMATE) colour replaces lane B's, scaled to lane B's
// luminance. tex: { detail, height, flat, mask } THREE textures (the lab loads them; node tests pass none and get the hook text only).
// A face blended from several scans takes the lead scan's maps (the maps are per scan: blending them is a next step).
export async function scanSkin(h, face, o = {}) {
  const THREE = o.THREE || (await import('three'));
  const L = o.L || _lib, k = L.k, n = h.body.geometry.attributes.position.count, a = new Float32Array(n * 3);
  for (let v = 0; v < k; v++) { const g = L.hv[v]; if (g >= n) continue; a[g * 3] = L.chart[v * 3]; a[g * 3 + 1] = L.chart[v * 3 + 1]; a[g * 3 + 2] = L.chart[v * 3 + 2]; }
  h.body.geometry.setAttribute('aScanUV', new THREE.BufferAttribute(a, 3));
  const id = face.scan.lead, H = L.byId[id], tex = o.tex || {};
  const blank = (c = 128) => { const t = new THREE.DataTexture(new Uint8Array([c, c, c, 255]), 1, 1); t.needsUpdate = true; return t; };
  const U = { scanDetail: { value: tex.detail || blank() }, scanHeight: { value: tex.height || blank() }, scanFlat: { value: tex.flat || blank(200) }, scanMask: { value: tex.mask || blank(0) },
    scanAmt: { value: new THREE.Vector4(o.detail ?? 1, o.bump ?? 0, o.albedo ?? 0, 0) }, scanTint: { value: new THREE.Vector3(1, 1, 1) }, scanTexel: { value: 1 / 1024 } };
  // the scan's colour scaled to lane B's skin luminance (its hue kept): the scan's exposure is the scan studio's, not ours
  const base = h.likeness?.skin?.lut?.base; if (base && H.skinHex) { const c = new THREE.Color(H.skinHex); c.convertSRGBToLinear?.(); const ly = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, lb = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]; const s = lb / Math.max(ly, 1e-4); U.scanTint.value.set(s, s, s); }
  h.useSkinHook({ key: 'scan-skin', uniforms: U, vertPars: 'attribute vec3 aScanUV; varying vec3 vScanUV;', vert: 'vScanUV = aScanUV;',
    fragPars: 'uniform sampler2D scanDetail, scanHeight, scanFlat, scanMask; uniform vec4 scanAmt; uniform vec3 scanTint; uniform float scanTexel; varying vec3 vScanUV;\nvec3 scanLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }',
    frag: SCAN_FRAG, normal: SCAN_NORMAL });
  h.scanSkin = { id, U, credit: L.credit };
  return { U, id, set: (d, b, al) => U.scanAmt.value.set(d ?? U.scanAmt.value.x, b ?? U.scanAmt.value.y, al ?? U.scanAmt.value.z, 0) };
}
// integration v3: the maps sampled BEFORE the branch (a texture fetch's implicit derivatives are undefined in non-uniform flow on a GPU:
// 1-px lines along the chart's edge, the same seam FACE3 found in lane D's skin patch); the use stays inside it
const SCAN_FRAG = /* glsl */`
  vec4 scMk = texture2D(scanMask, vScanUV.xy), scDt = texture2D(scanDetail, vScanUV.xy), scFl = texture2D(scanFlat, vScanUV.xy);
  if (vScanUV.z > 0.001) {
    float sm = vScanUV.z * scMk.r * (1.0 - hNotSkin);
    vec3 det = 1.0 + (scDt.rgb * 255.0 - 128.0) / 255.0;
    diffuseColor.rgb *= mix(vec3(1.0), clamp(det, 0.4, 1.8), scanAmt.x * sm);
    if (scanAmt.z > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, scanLin(scFl.rgb) * scanTint * clamp(det, 0.4, 1.8), scanAmt.z * sm);
  }`;
// the bump: the height texture's screen-space derivatives on the shading normal (Mikkelsen's surface-gradient form, as lane B's pores)
const SCAN_NORMAL = /* glsl */`
  if (scanAmt.y > 0.0) {   // (integration v3: a uniform condition only; sm is 0 off the chart, so the normal is unchanged there)
    float sm = vScanUV.z * texture2D(scanMask, vScanUV.xy).r;
    float hh = (texture2D(scanHeight, vScanUV.xy).r * 255.0 - 128.0) / 40000.0;      // metres
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
    vec2 dH = vec2(dFdx(hh), dFdy(hh)) * scanAmt.y * sm;
    vec3 R1 = cross(dpy, normal), R2 = cross(normal, dpx); float det = dot(dpx, R1) * faceDirection;
    vec3 gr = sign(det) * (dH.x * R1 + dH.y * R2); vec3 np = normalize(abs(det) * normal - gr);
    if (!any(isnan(np))) normal = np;
  }`;
// the maps as THREE textures (browser): linear data, no colour management (the shader decodes sRGB for 'flat' itself)
export async function loadScanMaps(THREE, L, id) {
  const H = L.byId[id], ld = new THREE.TextureLoader(), get = p => new Promise((res, rej) => ld.load(L.base + p, t => { t.colorSpace = THREE.NoColorSpace; t.flipY = true; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; res(t); }, undefined, rej));
  const [detail, height, flat, mask] = await Promise.all([get(H.maps.detail), get(H.maps.height), get(H.maps.flat), get(H.maps.mask)]);
  return { detail, height, flat, mask };
}
// a face record's report line (for labs and boards)
export const scanLabel = face => `scan ${face.scan.mix.map(([id, w]) => w < 1 ? `${id} ${Math.round(w * 100)}%` : id).join(' + ')}${face.spec.averageness ? ' avg ' + face.spec.averageness : ''}${face.spec.symmetry ? ' sym ' + face.spec.symmetry : ''}${face.spec.dimorphism ? ' dim ' + face.spec.dimorphism : ''} size x${r1(face.scan.scale * 10) / 10}`;
