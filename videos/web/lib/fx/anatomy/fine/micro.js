// ANATOMY / FINE / MICRO (DETAIL7, 8 Oct 2026): the skin's microstructure as RELIEF (height, mm), a function of the bind position, so it is
// seamless across charts and identical in the bake (JS, Cycles' displacement map) and in the engine (GLSL twin, MICRO_GLSL). Ours, CC0.
//
// What it models (the scales a photograph carries below the anatomical features):
//  - PORES: the follicular openings, funnels 0.08-0.3 mm across, ~0.03-0.12 mm deep, by region: largest and densest on the nose and the
//    medial cheeks (sebaceous), medium on the forehead and chin, small on the lateral cheeks and temples, none on the vermilion and the
//    lids, few and small on the body. Densities per cm2 as recalled from the dermatology literature (facial follicle density ~250-500 /cm2,
//    visible enlarged pores ~50-150 /cm2 on the cheeks); the depth grows with age and sex (men x1.2), shallower on young women.
//  - THE FURROW NETWORK (the skin's primary lines): a polygonal mesh of shallow furrows (Voronoi cell edges, cells 0.35-0.8 mm, 15-50 um deep),
//    pores at its junctions; coarser and deeper with age (the dermal network loosens: the cells stretch along the tension lines).
// Both are drawn from integer hashes (the same bits in JS and GLSL), so the two renderers show the same pores.
//
//   microHeight(p_mm, R) -> mm (negative = into the skin); R = { pore: [size, depth, density], net: [cell, depth], ani: [ax, ay, az, k] }
//   the region parameters come from regionMicro(A, p_mm, st) (features.js) and are baked per texel into the chart (the engine's alpha channel)

const U32 = x => x >>> 0;
// a small integer hash (lowbias32, Wellons), identical in GLSL (uint arithmetic)
export function hash32(x) { x = U32(x); x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16; return x >>> 0; }
const h3 = (i, j, k, s) => hash32(U32(i) ^ hash32(U32(j) ^ hash32(U32(k) ^ hash32(s))));
const u01 = x => (x >>> 8) / 16777216;

// jittered feature points of a 3-D grid of cell c (mm): the nearest and second-nearest distances, and the nearest point's hash
function worley(p, c, seed, keep) {
  const x = p[0] / c, y = p[1] / c, z = p[2] / c, ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let d1 = 1e9, d2 = 1e9, hb = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
    const h = h3(ix + a, iy + b, iz + e, seed);
    if (keep < 1 && u01(hash32(h ^ 0x9e3779b9)) > keep) continue;      // thinned: density x keep
    const fx = ix + a + u01(h), fy = iy + b + u01(hash32(h + 1)), fz = iz + e + u01(hash32(h + 2));
    const d = Math.hypot(fx - x, fy - y, fz - z);
    if (d < d1) { d2 = d1; d1 = d; hb = h; } else if (d < d2) d2 = d;
  }
  return { d1: d1 * c, d2: d2 * c, h: hb };
}

// R: pore = [mean diameter mm, depth mm, density per mm2], net = [cell mm, depth mm]; returns mm
// iteration 4: out (optional) receives out.occ, the pore's OPENING occlusion: a pore is a funnel (an opening 0.08-0.3 mm across over a duct
// 0.2-0.5 mm deep), not the shallow dimple its height models; inside the opening most of the sky is hidden, so a photograph records a pore as
// a dark dot (iteration 3: the dimple's own shading left the cheek's fine band unchanged or lower, 0.282 -> 0.239). occ = kO x the opening's
// coverage of the texel (a Gaussian of the opening's radius, pre-filtered by R.sig mm), kO 0.3-0.75 by the pore's depth
export const poreOccK = dep => Math.min(0.75, Math.max(0.3, 0.25 + 5 * dep));
// ITERATION 9: BAND-LIMITED TO THE TEXEL, THE REST TO THE LOBE. With R.sigH > 0 (mm: the texel's footprint as a Gaussian sigma) the relief is
// what a texel of that footprint holds, not a point sample of it: each pore pit (-d exp(-r^2/a^2), a^2 = r_open^2 / 1.2) and each furrow
// valley of the network (-D exp(-u^2/w^2) across the cell edge, u the distance to it, w = 0.04 cell) convolved with the footprint's Gaussian
// (the same closed form the GLSL twin uses for the engine's pixel), summed over the 27 cells around p. A point sample of features narrower
// than the texel (the network's furrows are 0.02-0.03 mm wide, a small pore's pit 0.05 mm, the 4096 head texel 0.086 mm) ALIASES: it writes
// a different slope into every texel, a white noise of normals that a specular lobe turns into frost and a raking light into specks (the
// same fault, far larger, in lane B's baked furrows: NOTES 'THE SPECKS'). What the filter removes is not lost: out.v receives the slope
// VARIANCE inside the footprint (E|grad h|^2 under the Gaussian minus the filtered gradient's square, closed forms below, (mm/mm)^2), which a
// microfacet lobe adds to its own (LEAN / Toksvig: alpha^2 + v): the sub-texel relief broadens and breaks the highlight instead of
// sparkling in it. sigH 0 (or absent) = the point sample, as before.
//   pores (2-D Gaussian pit, footprint s): q = 1 + 4 s^2 / a^2, A^2 = a^2 + 2 s^2,
//     E|grad h|^2 = 4 d^2 / a^4 exp(-2 r^2 / (a^2 + 4 s^2)) (2 s^2 / q^2 + r^2 / q^3),  |grad h_f|^2 = 4 d^2 a^4 r^2 / A^8 exp(-2 r^2 / A^2)
//   furrows (1-D Gaussian valley): q = 1 + 4 s^2 / w^2, W^2 = w^2 + 2 s^2,
//     E|h'|^2 = 4 D^2 / w^4 exp(-2 u^2 / (w^2 + 4 s^2)) (s^2 q^-1.5 + u^2 q^-2.5),  |h_f'|^2 = 4 D^2 w^2 u^2 / W^6 exp(-2 u^2 / W^2)
// (tools/micro9_check.mjs checks both against a brute-force Gaussian supersampling of the point relief.)
// ITERATION 10: WHAT THE LOBES SEE OF IT. A texel's slopes are not one Gaussian (LEAN's assumption, iteration 9) but a MIXTURE: the
// PLATEAU between the features, whose gentle undulation does broaden the lobe, and the features' INSIDES (a pore's infundibulum, a furrow's
// valley), whose walls either hide (a wall steeper than 45 degrees is self-shadowed under a 45-degree key and masked from a 45-degree view:
// Torrance and Sparrow's V-groove) or send their light far outside the highlight. Added into alpha^2 they turn the whole texel's highlight
// into a wide dim wash (the critic of iteration 9, from this tier's own numbers: a 60-year-old man's nose v 0.13-0.21 under the 4096
// texel, the point relief's mean |grad h|^2 0.385, against skin's measured whole specular lobe, Beckmann m 0.23-0.29 by region, m^2
// 0.055-0.084: Weyrich et al. 2006); a mixture keeps the plateau's lobe sharp and takes the insides' share of the footprint OUT of it: a
// highlight broken by pores and furrows, as the photographs show it. Per feature (a Gaussian pit or valley): its steepest slope
// g = 0.858 depth / width; its HIDDEN fraction kappa = smoothstep(HIDE.s0, HIDE.s1, g) (under ~15 degrees its facets lie within the lobe's
// own width; past 45 degrees they are hidden); its share of the footprint c = its filtered depth over its depth (the footprint's overlap
// with it). out.f = 1 - prod(1 - kappa c) (the lobes' weight x (1 - f)); out.vo = out.v x the unhidden features' share of it (the variance
// the lobes still widen by). out.v (iteration 9's) stays for the 'lean' twin.
export const HIDE = { s0: 0.27, s1: 1.0 };   // tan 15 deg, tan 45 deg (OURS: the lobe's own width; the V-groove's masking slope at 45 degrees)
const hideK = g => { const t = Math.min(1, Math.max(0, (g - HIDE.s0) / (HIDE.s1 - HIDE.s0))); return t * t * (3 - 2 * t); };
export function microHeight(p, R, seed = 7, out = null) {
  if (R.sigH > 0) return microFiltered(p, R, seed, out);
  let h = 0;
  if (R.pore && R.pore[1] > 0 && R.pore[2] > 0) {
    // cell for the density: one candidate per c^3 cell, ~ one per c^2 of a surface crossing it => c = 1 / sqrt(density); keep thins further
    const dens = R.pore[2], c = 1 / Math.sqrt(dens * 1.6), w = worley(p, c, seed, 1);
    const dia = R.pore[0] * (0.6 + 0.8 * u01(hash32(w.h ^ 0x51ed27))), r = dia * 0.5;
    const x = w.d1 / r;
    const dep = R.pore[1] * (0.6 + 0.8 * u01(hash32(w.h ^ 0x2c1b3c6d)));
    if (x < 3) h -= dep * Math.exp(-x * x * 1.2) * (1 - Math.exp(-((3 - x) ** 2)));
    if (out) { const s2 = 2 * (R.sig || 0) ** 2, A2 = r * r + s2; out.occ = poreOccK(dep) * (r * r / A2) * Math.exp(-(w.d1 * w.d1) / A2); }
  }
  if (R.net && R.net[1] > 0) {
    const w = worley(p, R.net[0], seed + 101, 1), e = (w.d2 - w.d1) / R.net[0];   // 0 on a cell edge
    h -= R.net[1] * Math.exp(-((e / 0.08) ** 2));
  }
  return h;
}

// (iteration 9) the band-limited relief and its sub-footprint slope variance (see microHeight); out.occ as the point sample's (the nearest
// pore's opening, pre-filtered by R.sig), out.v the variance. R.nrm (unit, optional): the surface's normal at p, so each 3-D feature is cut
// by the surface's plane exactly (a pit whose centre lies z off the plane is a pit of depth d exp(-z^2/a^2) in it; a furrow's in-plane width
// is w / |grad_t u|); without it the 3-D distance stands in for the in-plane one (the engine's GLSL twin does so)
function microFiltered(p, R, seed, out) {
  const s = R.sigH, s2 = s * s, n = R.nrm || null; let h = 0, v = 0, vo = 0, keep = 1;   // (iteration 10) vo, keep = prod(1 - kappa c)
  if (R.pore && R.pore[1] > 0 && R.pore[2] > 0) {
    const dens = R.pore[2], c = 1 / Math.sqrt(dens * 1.6), ix = Math.floor(p[0] / c), iy = Math.floor(p[1] / c), iz = Math.floor(p[2] / c);
    let gx = 0, gy = 0, gz = 0, E = 0, dn = 1e18, hn = 0, sV = 0, sVo = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
      const hq = h3(ix + a, iy + b, iz + e, seed);
      let dx = p[0] - (ix + a + u01(hq)) * c, dy = p[1] - (iy + b + u01(hash32(hq + 1))) * c, dz = p[2] - (iz + e + u01(hash32(hq + 2))) * c;
      const d2 = dx * dx + dy * dy + dz * dz; if (d2 < dn) { dn = d2; hn = hq; }
      const dia = R.pore[0] * (0.6 + 0.8 * u01(hash32(hq ^ 0x51ed27))), a2 = dia * dia * 0.25 / 1.2, A2 = a2 + 2 * s2;
      let r2 = d2, amp = 1;
      if (n) { const z = dx * n[0] + dy * n[1] + dz * n[2]; dx -= z * n[0]; dy -= z * n[1]; dz -= z * n[2]; r2 = Math.max(0, d2 - z * z); amp = Math.exp(-z * z / a2); }
      if (r2 > 9 * (a2 + 4 * s2) || amp < 1e-4) continue;
      const dep = amp * R.pore[1] * (0.6 + 0.8 * u01(hash32(hq ^ 0x2c1b3c6d))), K = dep * a2 / A2, w = Math.exp(-r2 / A2);
      h -= K * w; const gk = 2 * K * w / A2; gx += dx * gk; gy += dy * gk; gz += dz * gk;
      const q = 1 + 4 * s2 / a2, Ei = 4 * dep * dep / (a2 * a2) * Math.exp(-2 * r2 / (a2 + 4 * s2)) * (2 * s2 / (q * q) + r2 / (q * q * q)); E += Ei;
      // (iteration 10) this pit's own sub-footprint variance, its hidden fraction (its steepest slope 0.858 dep / a) and its share of the footprint
      const vi = Math.max(0, Ei - gk * gk * (dx * dx + dy * dy + dz * dz)), kap = hideK(0.858 * dep / Math.sqrt(a2));
      sV += vi; sVo += (1 - kap) * vi; keep *= 1 - kap * (a2 / A2) * w;
    }
    const vp = Math.max(0, E - (gx * gx + gy * gy + gz * gz)); v += vp; vo += sV > 0 ? vp * sVo / sV : 0;
    if (out) { const dia = R.pore[0] * (0.6 + 0.8 * u01(hash32(hn ^ 0x51ed27))), r = dia * 0.5, dep = R.pore[1] * (0.6 + 0.8 * u01(hash32(hn ^ 0x2c1b3c6d)));
      const so2 = 2 * (R.sig || 0) ** 2, A2 = r * r + so2; out.occ = poreOccK(dep) * (r * r / A2) * Math.exp(-dn / A2); }
  } else if (out) out.occ = 0;
  if (R.net && R.net[1] > 0) {
    // the valley across the cell edge: u = (d2 - d1) / 2 (0 on the edge), its in-plane gradient g = |grad_t u| (1 where the two cells' points
    // lie across the edge in the plane, less where the 3-D edge cuts the surface obliquely: a wider, gentler valley in the skin)
    const wq = worleyV(p, R.net[0], seed + 101), D = R.net[1], w0 = 0.04 * R.net[0];
    let ux = 0.5 * (wq.v2[0] / wq.d2 - wq.v1[0] / wq.d1), uy = 0.5 * (wq.v2[1] / wq.d2 - wq.v1[1] / wq.d1), uz = 0.5 * (wq.v2[2] / wq.d2 - wq.v1[2] / wq.d1);
    if (n) { const z = ux * n[0] + uy * n[1] + uz * n[2]; ux -= z * n[0]; uy -= z * n[1]; uz -= z * n[2]; }
    const g = Math.max(0.05, Math.hypot(ux, uy, uz)), u = 0.5 * (wq.d2 - wq.d1) / g, w2 = (w0 / g) ** 2, W2 = w2 + 2 * s2, q = 1 + 4 * s2 / w2;
    h -= D * Math.sqrt(w2 / W2) * Math.exp(-u * u / W2);
    const E = 4 * D * D / (w2 * w2) * Math.exp(-2 * u * u / (w2 + 4 * s2)) * (s2 * q ** -1.5 + u * u * q ** -2.5), G = 4 * D * D * w2 * u * u / (W2 * W2 * W2) * Math.exp(-2 * u * u / W2);
    // (iteration 10) the valley's hidden fraction (its steepest slope 0.858 D / its in-plane width) and its share of the footprint
    const vf = Math.max(0, E - G), kap = hideK(0.858 * D / Math.sqrt(w2));
    v += vf; vo += (1 - kap) * vf; keep *= 1 - kap * Math.sqrt(w2 / W2) * Math.exp(-u * u / W2);
  }
  if (out) { out.v = v; out.vo = vo; out.f = 1 - keep; }
  return h;
}
// worley with the offsets to the two nearest points (p - f1, p - f2), mm
function worleyV(p, c, seed) {
  const x = p[0] / c, y = p[1] / c, z = p[2] / c, ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let d1 = 1e9, d2 = 1e9, v1 = [0, 0, 1], v2 = [0, 0, 1];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
    const hq = h3(ix + a, iy + b, iz + e, seed), ox = (ix + a + u01(hq) - x) * c, oy = (iy + b + u01(hash32(hq + 1)) - y) * c, oz = (iz + e + u01(hash32(hq + 2)) - z) * c;
    const d = Math.hypot(ox, oy, oz);
    if (d < d1) { d2 = d1; v2 = v1; d1 = d; v1 = [-ox, -oy, -oz]; } else if (d < d2) { d2 = d; v2 = [-ox, -oy, -oz]; }
  }
  return { d1: Math.max(d1, 1e-9), d2: Math.max(d2, 1e-9), v1, v2 };
}

// the GLSL twin: the pores only (the furrow network lies under a pixel at every engine framing we shoot, and the specular lobe's
// roughness carries its energy), with its analytic gradient in bind space (per metre). fineMicro(p_m, R) -> vec4(grad.xyz, h_mm)
// ITERATION 2: the pores are PRE-FILTERED to the pixel instead of faded out under it (iteration 1 faded them to zero below ~1.6 diameters a
// pixel: at 1:1 and even at 2:1 no pore was drawn, cheek 0.5-1 mm band 0.17-0.19 against the photographs' 0.9-1.4). A pore is a Gaussian
// pit -d exp(-r^2/a^2); the camera's pixel (a Gaussian of sigma s) turns it into -d a^2/(a^2 + 2 s^2) exp(-r^2/(a^2 + 2 s^2)): the same
// volume, wider and shallower, which is what a photograph of a pore under a pixel records (a soft dark stipple, no sparkle). Every pore of
// the 27 cells around the point is summed (filtered pores overlap). Also the pit's occlusion, filtered the same way (finePoreOcc).
// ITERATION 11: the engine's twin of iterations 9-10. The filter above removed each pore's slope inside the pixel and handed it to nobody:
// the engine's lobes saw a smooth sub-pixel skin. Now finePores also returns what the lobes see of it, with micro.js's closed forms (the
// pores' part of microFiltered; the 3-D distance for the in-plane one, as before): fineLobeV, the unhidden pits' sub-pixel slope variance
// ((mm/mm)^2: the lobes widen by it, r -> (r^4 + v)^(1/4) on three's GGX, alpha = r^2), and fineHide, the hidden share of the pixel
// (1 - prod(1 - kappa c): the pits' steep walls take their share OUT of the lobes' weight). The furrow network has no GLSL twin (under a
// pixel at every engine framing): its variance stays in the skin's own roughness (SKIN7's Toksvig) and is not added here.
export const MICRO_GLSL = /* glsl */`
uint fineHash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
uint fineH3(int i, int j, int k, uint s) { return fineHash(uint(i) ^ fineHash(uint(j) ^ fineHash(uint(k) ^ fineHash(s)))); }
float fineU01(uint x) { return float(x >> 8u) / 16777216.0; }
float finePoreOcc = 0.0, fineLobeV = 0.0, fineHide = 0.0;
// pores: R = vec3(diameter mm, depth mm, density per mm2); p in mm; sig = the pixel's footprint sigma (mm); returns vec4(dh/dp (mm per mm), h mm)
vec4 finePores(vec3 p, vec3 R, uint seed, float sig) {
  finePoreOcc = 0.0; fineLobeV = 0.0; fineHide = 0.0;
  if (R.y <= 0.0 || R.z <= 0.0) return vec4(0.0);
  float c = 1.0 / sqrt(R.z * 1.6); vec3 q = p / c; ivec3 iq = ivec3(floor(q));
  vec3 g = vec3(0.0); float hh = 0.0, s2 = 2.0 * sig * sig, E7 = 0.0, sV7 = 0.0, sVo7 = 0.0, keep7 = 1.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int e = -1; e <= 1; e++) {
    uint h = fineH3(iq.x + a, iq.y + b, iq.z + e, seed);
    vec3 f = (vec3(iq + ivec3(a, b, e)) + vec3(fineU01(h), fineU01(fineHash(h + 1u)), fineU01(fineHash(h + 2u)))) * c;
    vec3 dv = p - f; float d2 = dot(dv, dv);
    float dia = R.x * (0.6 + 0.8 * fineU01(fineHash(h ^ 0x51ed27u))), a2 = dia * dia * 0.25 / 1.2, A2 = a2 + s2;
    if (d2 > 9.0 * max(A2, dia * dia * 0.25 + s2)) continue;
    float dep0 = R.y * (0.6 + 0.8 * fineU01(fineHash(h ^ 0x2c1b3c6du))), dep = dep0 * a2 / A2, w = exp(-d2 / A2);
    hh -= dep * w; g += dv * (2.0 * dep * w / A2);
    // iteration 11 (micro.js microFiltered, the pores): this pit's sub-pixel variance, its hidden fraction and its share of the pixel
    float qv = 1.0 + 2.0 * s2 / a2, gk = 2.0 * dep * w / A2;
    float Ei = 4.0 * dep0 * dep0 / (a2 * a2) * exp(-2.0 * d2 / (a2 + 2.0 * s2)) * (s2 / (qv * qv) + d2 / (qv * qv * qv)); E7 += Ei;
    float vi = max(0.0, Ei - gk * gk * d2), kap = smoothstep(${HIDE.s0.toFixed(4)}, ${HIDE.s1.toFixed(4)}, 0.858 * dep0 / sqrt(a2));
    sV7 += vi; sVo7 += (1.0 - kap) * vi; keep7 *= 1.0 - kap * (a2 / A2) * w;
    float r2 = dia * dia * 0.25, A2o = r2 + s2;                                     // iteration 4: the opening's occlusion (micro.js)
    finePoreOcc += clamp(0.25 + 5.0 * dep / max(a2 / A2, 1e-3), 0.3, 0.75) * (r2 / A2o) * exp(-d2 / A2o);
  }
  float vp7 = max(0.0, E7 - dot(g, g)); fineLobeV = sV7 > 0.0 ? vp7 * sVo7 / sV7 : 0.0; fineHide = 1.0 - keep7;
  return vec4(g, hh);
}`;
