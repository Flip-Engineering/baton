// EYES (EYE7_VERSION 5, 8 Oct): THE ENGINE EYE, from the same record and maps as the Cycles eye (model.js has the sources). Opt-in:
//   buildEyes(h, { ...as before, eye7: {} })                 (likeness/eyes.js; makePerson(name, { eyes: { eye7: {} } }) reaches it)
//   eye7: { stage: 'studio' | 'window' | ..., seed, age (years), irisRes: [NA, NR], scleraRes: [NU, NV], inset (mm, 0.4) }
// Without `eye7` likeness/eyes.js draws exactly as before. What it draws, per fragment, in each eye's own frame (mm; +z the corneal axis,
// the origin the bind centre c of likeness/eyes.js fitEyes, the globe resized to the anatomical 12 mm with the corneal apex kept):
//  - the SURFACE analytic: the view ray met with the globe (r 12) and the cornea (r 7.8, meeting the globe at the 11.7 mm limbus), so the
//    tear film's reflection (its own F0 from n 1.336, roughness of a liquid film) and the key's CATCHLIGHT (the key as the area source it
//    is: a disc of the key's angular radius, radiance E / solid angle, reflected with the tear film's Fresnel: FACE5's method with the
//    film's own F0 and no gain) come from the stage's light; nothing is painted;
//  - the IRIS by PARALLAX REFRACTION: the view ray refracted at the cornea (one surface, the keratometric index 1.3375) and marched to the
//    iris: the cone from the pupil margin (on the lens, ACD(age) behind the apex) back to its root, displaced by the grown stroma relief
//    (iris.js), the grown albedo at the hit (stretched with the pupil), the shading normal from the relief; the PUPIL from the stage's
//    light (Watson and Yellott 2012); through it the dark fundus; beyond the root the pigmented angle;
//  - the LIMBUS as the sclera's opaque bevel over the clear cornea (0.8 mm, over the horizontal-ellipse limbus 11.7 x 10.8 mm): through
//    its thinning edge the angle shows dark: the limbal ring as anatomy makes it, not a painted ring;
//  - the SCLERA: the grown vessel and melanosis map, its Kubelka-Munk albedo (sclera.js), no specular of its own under the tear film;
//  - the OCCLUSION SHELL: the lids as DRAWN (the skin read round each globe, 72 bins: the lid's edge on the eye and how far its top
//    stands in front of the eye within 1.5 mm of the edge) cast the key's shadow (the ray toward each directional light passed over the
//    lid's edge; soft by the key's angular size) on the white and, through the cornea, on the iris; the sky is occluded by them as by a
//    wall of that height (1 - T^2 / 2 (T^2 + d^2) a lid), and the tear film's reflection of the room with them;
//  - the eye SET BACK along its axis by the cornea's penetration through the lid edge (the robust 75th percentile, +0.05 mm, capped
//    1.2 mm: the lid rests ON the eye, the corneal bulge included: eye7_cycles.py seat_depth, the same rule);
//  - the WET LINE: the lower TEAR MENISCUS as geometry: a concave water fillet (radius 0.25 mm, the meniscus height: Yokoi et al. 2004)
//    in the corner of the eye and the lower lid's posterior margin, thinning to the canthi; its normals sweep 90 degrees, so the key and
//    the room draw a thin bright thread along it (water's F0 0.021, added over what lies behind it: the film transmits ~98 %);
//  - the CARUNCLE (FACE3's mound at the landmark canthus) coloured by the person's own skin model (the eye7 record);
//  - (EYE7_VERSION 4) THE WET MARGIN: the posterior lid margin (lid wiper, mucocutaneous junction, to the meibomian row, fading to the grey
//    line) as a strip laid ON the lid as drawn, both lids (marginGeometry): it shows as much margin as the lid has (none on a knife edge,
//    the strip on FACE7's lid tissue: the seam both lanes agreed); the record's mucosa colour under the tear film (its F0, the key's disc);
//    the UPPER tear meniscus beside the lower (0.12 mm); the meniscus wound so its front face is the water's (it 3's side -1 eye was not).
//  - (EYE7_VERSION 5) THE LIGHT INTO THE CHAMBER, REFRACTED: each directional light reaches the iris point H the way it physically does: it
//    enters the cornea at the point PE whose refracted ray (n 1.3375) lands on H (a fixed point: the exit of the ray from H back along the
//    refracted direction, five steps), loses its Fresnel reflection there, is CONCENTRATED or spread by the cornea's lens (the flux through
//    PE's patch across the beam over the iris patch it lands on: two neighbours' entry points, finite differences), and is shadowed by the
//    lids at PE (the shell); the iris's relief then takes its own cosine of the refracted direction. A lit crescent opposite the light's
//    reflection and a shadowed band under the upper lid come from the transport, not from a map. The white keeps its own direct light
//    (the shell at its point, the globe's normal). Until it 4 the iris was lit along the UNREFRACTED light with the shell tested where that
//    straight line left the cornea: wrong by a factor 0.3-3 on our lineup (labs/eyes/eye7_keyprobe.mjs, which measures both, forward).
//  - (it 7) THE GAZE: each globe turned about its centre to fixate a target by Listing's law (listingRotation, the same rule as
//    eye7_cycles.py), in the vertex shader and the shader's frame, per frame (E.look('camera' | 'ahead' | world point | { yaw, pitch })); the
//    lids' shell, the meniscus and the margin stay with the skin (the shell is read in the head's frame).
// NOT here (said plainly): the lid margin's thickness (FACE7's lidTissue builds it in the engine's lid; eye7_cycles.py margin_rim builds it
// in Cycles on a knife-edge lid), the plica, the lashes (FACE7 / HAIR7), the lashes' shadow on the eye (they cast none here; in Cycles they do), subsurface in the sclera.
import * as THREE from 'three';
import { eye7Record, eye7Seed, EYE7_VERSION } from './index.js';
import { ANAT, IRIS_PIG, GAZE, eyeAnatomy } from './model.js';
import { THETA_MAX } from './sclera.js';
import { loadSkinModel } from '../../likeness/skin_lut.js';

export const ENGINE7 = { bins: 72, irisRes: [1024, 256], scleraRes: [1024, 256], hRange: [-0.4, 0.25], steps: 24, tearRough: 0.025, inset: 0.4,
  fundus: [0.006, 0.004, 0.0035], menR: ANAT.tear.lowH, menUpR: ANAT.tear.upH, menRows: 7, stripRows: 6,
  gaze: 'camera', gazeLimit: GAZE.eyeOnlyDeg };   // (it 7) the gaze target; (v8) the eye's share of a held fixation (model.js GAZE / eyeHeadSplit: beyond it the head takes the rest)
const TAU = Math.PI * 2;
const f0Of = n => ((n - 1) / (n + 1)) ** 2;
// (it 7) Listing's law (Tweed and Vilis 1990): the rotation (row-major 3x3, eye -> head; x across, y up, z forward) that turns the primary
// direction +z onto d about the axis z x d (in the frontal plane: no torsion), the angle held to limitDeg. The same rule as
// eye7_cycles.py listing_rotation, so both renderers turn the eye alike.
export function listingRotation(d, limitDeg = GAZE.eyeOnlyDeg) {
  const I = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], deg: 0, target: 0, clamped: false }; if (!d) return I;
  const n = Math.hypot(d[0], d[1], d[2]); if (n < 1e-9) return I;
  const x = d[0] / n, y = d[1] / n, z = d[2] / n, sa = Math.hypot(x, y); if (sa < 1e-9) return I;
  let ang = Math.atan2(sa, z); const target = ang * 180 / Math.PI, lim = limitDeg * Math.PI / 180, clamped = ang > lim; ang = Math.min(ang, lim);
  const ax = -y / sa, ay = x / sa, s = Math.sin(ang), c1 = 1 - Math.cos(ang);   // axis z x d = (-y, x, 0)
  // R = I + s K + (1 - cos) K^2, K the cross matrix of (ax, ay, 0)
  return { R: [1 - c1 * ay * ay, c1 * ax * ay, s * ay, c1 * ax * ay, 1 - c1 * ax * ax, -s * ax, -s * ay, s * ax, 1 - c1 * (ax * ax + ay * ay)], deg: ang * 180 / Math.PI, target, clamped };
}

// ---------------------------------------------------------------- the lids as drawn, read round each globe (bind space, mm in the eye's frame)
// per bin of azimuth al (0 temporal, 90 up, 180 nasal, mirrored per side as fitEyes): edge = the first radius from the axis at which the
// skin lies within 0.3 mm of, or in front of, the sphere the lids were seated on (the pocket folded behind the globe ignored); top = how far
// the skin's frontmost point within 1.5 mm beyond the edge stands in front of the eye's surface at the edge, along the axis; pen = how far
// the eye's surface (the corneal bulge included) stands in front of the skin just outside the edge (the set-back's measure)
function lidScan(h, e, A, inset0, NA) {
  const B = h.body.geometry.attributes.position.array, BI = h.body.geometry.index.array, AH = h.aHero, c = e.c, side = e.side;
  const R = A.globeR, S = Array.from({ length: NA }, () => []);
  for (let t = 0; t < BI.length; t += 3) { const a = BI[t], b = BI[t + 1], cc = BI[t + 2]; if (AH && AH[a * 4] !== 0 && AH[a * 4] !== 11) continue;
    if (Math.hypot(B[a * 3] - c.x, B[a * 3 + 1] - c.y) > 0.02 || B[a * 3 + 2] < c.z - 0.004) continue;
    for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5 - i; j++) { const u = i / 5, v = j / 5, w = 1 - u - v;
      const dx = (B[a * 3] * u + B[b * 3] * v + B[cc * 3] * w - c.x) * 1000, dy = (B[a * 3 + 1] * u + B[b * 3 + 1] * v + B[cc * 3 + 1] * w - c.y) * 1000,
        dz = (B[a * 3 + 2] * u + B[b * 3 + 2] * v + B[cc * 3 + 2] * w - c.z) * 1000, rho = Math.hypot(dx, dy);
      if (rho > 16) continue; const al = Math.atan2(dy, dx * side), k = Math.floor((((al / TAU) % 1) + 1) % 1 * NA) % NA; S[k].push(rho, dz); } }
  const zSph = (rho, zg) => zg + Math.sqrt(Math.max(0, R * R - rho * rho));
  const edge = new Float64Array(NA);
  for (let k = 0; k < NA; k++) { let m = 16; const s = S[k]; for (let i = 0; i < s.length; i += 2) if (s[i] < R && s[i + 1] - zSph(s[i], -inset0) > -0.3 && s[i] < m) m = s[i]; edge[k] = m; }
  const circ = (a, f) => Float64Array.from(a, (_, k) => f(k));
  const med = a => circ(a, k => { const w = [-2, -1, 0, 1, 2].map(d => a[(k + d + NA) % NA]).sort((x, y) => x - y); return w[2]; });
  const box = a => circ(a, k => [-2, -1, 0, 1, 2].reduce((s, d) => s + a[(k + d + NA) % NA], 0) / 5);
  const E = box(med(edge));
  // the skin's frontmost z (mm) per bin within [r0, r1] mm from the axis (the bin and its neighbours)
  const front = (k, r0, r1) => { let z = -1e9; for (const d of [-1, 0, 1]) { const s = S[(k + d + NA) % NA]; for (let i = 0; i < s.length; i += 2) if (s[i] >= r0 && s[i] <= r1 && s[i + 1] > z) z = s[i + 1]; } return z; };
  return { E, front, S, n: S.reduce((s, a) => s + a.length / 2, 0) };
}
function eyeZ(A, zg, zcc) { const R = A.globeR, rc = A.rc; return rho => Math.max(zg + Math.sqrt(Math.max(0, R * R - rho * rho)), rho < rc ? zcc + Math.sqrt(Math.max(0, rc * rc - rho * rho)) : -1e9); }
function pct(a, p) { const s = [...a].sort((x, y) => x - y); if (!s.length) return 0; const i = (s.length - 1) * p, i0 = Math.floor(i); return s[i0] + (s[Math.min(s.length - 1, i0 + 1)] - s[i0]) * (i - i0); }

// the seat and the shell per eye: the set-back, then the lid's top over its edge (both mm)
function seatEye(h, e, A, o) {
  const NA = o.bins, inset0 = o.inset, R = A.globeR, rc = A.rc, rl = A.rl;
  const zcc0 = Math.sqrt(R * R - rl * rl) - Math.sqrt(rc * rc - rl * rl);   // the cornea's centre over the globe's (the spheres meet at rl)
  const L = lidScan(h, e, A, inset0, NA), z0 = eyeZ(A, -inset0, zcc0 - inset0);
  const pen = []; for (let k = 0; k < NA; k++) { const r = L.E[k]; if (r >= 15.9) continue; let z = -1e9;
    for (let dr = 0.05; dr < 1.6 && z < -1e8; dr += 0.4) z = L.front(k, r + dr - 0.05, r + dr + 0.35);
    if (z > -1e8) { const p = z0(r) - z; if (p > -1 && p < 2) pen.push(p); } }
  const back = Math.min(1.2, Math.max(0, pct(pen, 0.75)) + 0.05), inset = inset0 + back, zg = -inset, zcc = zcc0 - inset, z1 = eyeZ(A, zg, zcc);
  const top = new Float64Array(NA); for (let k = 0; k < NA; k++) { const r = L.E[k], z = L.front(k, r, r + 1.5); top[k] = z > -1e8 ? Math.max(0, Math.min(6, z - z1(r))) : 0; }
  const topM = Float64Array.from(top, (_, k) => [-2, -1, 0, 1, 2].map(d => top[(k + d + NA) % NA]).sort((x, y) => x - y)[2]);
  const at = (arr, deg) => +arr[Math.round(((deg / 360) % 1) * NA) % NA].toFixed(2);
  return { edge: L.E, top: topM, inset, back, zg, zcc, S: L.S, samples: L.n, pen75: +pct(pen, 0.75).toFixed(3),
    report: { set_back_mm: +back.toFixed(3), inset_mm: +inset.toFixed(3), edge_mm: { up: at(L.E, 90), down: at(L.E, 270), nasal: at(L.E, 180), temporal: at(L.E, 0) },
      lid_top_mm: { up: at(topM, 90), down: at(topM, 270), up45: at(topM, 60), up135: at(topM, 120) }, samples: L.n } };
}

// ---------------------------------------------------------------- textures (both eyes stacked: side +1 rows [0, 0.5), side -1 rows [0.5, 1))
const toSRGB8 = v => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); };
function atlas(W, H, fill) { const D = new Uint8Array(W * H * 2 * 4); fill(D); const t = new THREE.DataTexture(D, W, H * 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true; return t; }
function irisAtlas(maps, [lo, hi]) { const { NA, NR } = maps[0].iris;
  return atlas(NA, NR, D => { maps.forEach((m, k) => { const I = m.iris; for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const q = i * NA + j, o = ((k * NR + i) * NA + j) * 4;
    D[o] = toSRGB8(I.albedo[q * 3]); D[o + 1] = toSRGB8(I.albedo[q * 3 + 1]); D[o + 2] = toSRGB8(I.albedo[q * 3 + 2]); D[o + 3] = Math.round(255 * Math.max(0, Math.min(1, (I.height[q] - lo) / (hi - lo)))); } }); }); }
function scleraAtlas(maps) { const { NU, NV } = maps[0].sclera;
  return atlas(NU, NV, D => { maps.forEach((m, k) => { const S = m.sclera; for (let i = 0; i < NV; i++) for (let j = 0; j < NU; j++) { const q = i * NU + j, o = ((k * NV + i) * NU + j) * 4;
    D[o] = toSRGB8(S.albedo[q * 3]); D[o + 1] = toSRGB8(S.albedo[q * 3 + 1]); D[o + 2] = toSRGB8(S.albedo[q * 3 + 2]); D[o + 3] = Math.round(255 * S.limbus[q]); } }); }); }
// the lids' shell: one row of NA texels, rg = (edge, top) of the side +1 eye, ba = the side -1 eye (mm; half floats: filterable in WebGL2)
function lidTexture(seats, NA) { const D = new Uint16Array(NA * 4);
  for (let k = 0; k < NA; k++) seats.forEach((s, i) => { D[k * 4 + i * 2] = THREE.DataUtils.toHalfFloat(s.edge[k]); D[k * 4 + i * 2 + 1] = THREE.DataUtils.toHalfFloat(s.top[k]); });
  const t = new THREE.DataTexture(D, NA, 1, THREE.RGBAFormat, THREE.HalfFloatType); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t; }
const blank = () => { const t = new THREE.DataTexture(new Uint8Array([40, 30, 25, 128]), 1, 1); t.needsUpdate = true; return t; };

// ---------------------------------------------------------------- geometry: globe + corneal cap per eye (positions in bind; aEyeL = the eye-frame vertex, m)
function globeGeometry(eyes, seats, A, head, { nT = 64, nP = 96 } = {}) {
  const pos = [], loc = [], nrm = [], idx = [], si = [], sw = []; let base = 0;
  const R = A.globeR, rc = A.rc, rl = A.rl;
  eyes.forEach((e, n) => { const S = seats[n], thL = Math.asin(Math.min(0.99, rl / R)), zcc = S.zcc, zg = S.zg;
    for (let i = 0; i <= nT; i++) { const th = (i / nT) ** 1.35 * 2.6;
      for (let j = 0; j <= nP; j++) { const ph = j / nP * TAU, d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        // along d from the globe's centre: the cornea in front of the limbus, the globe behind (blended over ~1 degree each side)
        const oz = zg - zcc, b = oz * d[2], tc = -b + Math.sqrt(Math.max(0, b * b - (oz * oz - rc * rc))), k = THREE.MathUtils.smoothstep(th, thL - 0.017, thL + 0.017);
        const Rr = tc * (1 - k) + R * k, p = [d[0] * Rr, d[1] * Rr, zg + d[2] * Rr];
        const nc = [p[0], p[1], p[2] - zcc], ln = Math.hypot(...nc), nn = [0, 1, 2].map(q => nc[q] / ln * (1 - k) + d[q] * k), l2 = Math.hypot(...nn);
        pos.push(e.c.x + p[0] / 1000, e.c.y + p[1] / 1000, e.c.z + p[2] / 1000); loc.push(p[0] / 1000, p[1] / 1000, p[2] / 1000, e.side);
        nrm.push(nn[0] / l2, nn[1] / l2, nn[2] / l2); si.push(head, 0, 0, 0); sw.push(1, 0, 0, 0); } }
    for (let i = 0; i < nT; i++) for (let j = 0; j < nP; j++) { const a = base + i * (nP + 1) + j, b = a + nP + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    base += (nT + 1) * (nP + 1); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aEye7L', new THREE.Float32BufferAttribute(loc, 4));   // (it 7) renamed: motion's EyePlayer (CPU) leaves this mesh to E.look
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx); return g;
}
// each triangle wound so its front face is on the side its vertex normals point to
function windTo(idx, pos, nrm) {
  for (let t = 0; t < idx.length; t += 3) { const [i, j, k] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const u = [pos[j] - pos[i], pos[j + 1] - pos[i + 1], pos[j + 2] - pos[i + 2]], w = [pos[k] - pos[i], pos[k + 1] - pos[i + 1], pos[k + 2] - pos[i + 2]];
    const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    let d = 0; for (const q of [i, j, k]) d += g[0] * nrm[q] + g[1] * nrm[q + 1] + g[2] * nrm[q + 2];
    if (d < 0) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; } }
}
// the TEAR MENISCUS: a concave fillet of radius r in the corner of the eye and the lid's posterior face, r x sin^0.5 toward the canthi; normals
// out of the water (toward the fillet's centre of curvature). The lower one from the nasal to the temporal canthus (185..355 degrees, r the
// lower meniscus' height 0.25 mm), (EYE7_VERSION 4) the upper one (5..175 degrees, 0.12 mm: Cycles' pair; Johnson and Murphy 2006)
function meniscusGeometry(eyes, seats, A, head, o) {
  const pos = [], nrm = [], idx = [], si = [], sw = []; let base = 0; const R = A.globeR, rc = A.rc, NA = o.bins, ns = o.menRows, ncol = 86;
  const LIDS = [{ d0: 185, d1: 355, r0: o.menR }, { d0: 5, d1: 175, r0: o.menUpR }];
  eyes.forEach((e, n) => { const S = seats[n], zE = eyeZ(A, S.zg, S.zcc), edgeAt = deg => { const u = ((deg / 360) % 1 + 1) % 1 * NA, k0 = Math.floor(u) % NA, f = u - Math.floor(u); return S.edge[k0] * (1 - f) + S.edge[(k0 + 1) % NA] * f; };
    for (const { d0, d1, r0 } of LIDS) {
    for (let c = 0; c < ncol; c++) { const t = c / (ncol - 1), deg = d0 + (d1 - d0) * t, al = deg * Math.PI / 180, r = r0 * Math.sin(Math.PI * t) ** 0.5;
      const rho = Math.min(edgeAt(deg), R - 0.5), ux = e.side * Math.cos(al), uy = Math.sin(al);
      const P = q => [ux * q, uy * q, zE(q)], C = P(rho), a = P(rho - 0.02), b = P(rho + 0.02), es = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], le = Math.hypot(...es); es.forEach((_, i) => { es[i] /= le; });
      const ctr = rho < rc - 0.2 && rho < A.rl ? [0, 0, S.zcc] : [0, 0, S.zg], nn = [C[0] - ctr[0], C[1] - ctr[1], C[2] - ctr[2]], ln = Math.hypot(...nn); nn.forEach((_, i) => { nn[i] /= ln; });
      const O = [0, 1, 2].map(i => C[i] - r * es[i] + r * nn[i]);
      for (let s = 0; s < ns; s++) { const ph = s / (ns - 1) * Math.PI / 2, p = [0, 1, 2].map(i => O[i] + r * (Math.sin(ph) * es[i] - Math.cos(ph) * nn[i]) + 0.012 * nn[i]);
        const w = [0, 1, 2].map(i => -Math.sin(ph) * es[i] + Math.cos(ph) * nn[i]);
        pos.push(e.c.x + p[0] / 1000, e.c.y + p[1] / 1000, e.c.z + p[2] / 1000); nrm.push(...w); si.push(head, 0, 0, 0); sw.push(1, 0, 0, 0); } }
    for (let c = 0; c < ncol - 1; c++) for (let s = 0; s < ns - 1; s++) { const a = base + c * ns + s, b = a + ns; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    base += ncol * ns; } });
  windTo(idx, pos, nrm);   // (it 4) the front face on the water's side: three flips a double-sided normal on a back face (it 3's side -1 eye was)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx); return g;
}
// (EYE7_VERSION 4) THE WET MARGIN: the posterior lid margin (the lid wiper, the mucocutaneous junction, the meibomian row: ANAT.margin's
// bands; Knop et al. 2011) laid ON THE LID AS DRAWN, both lids, canthus to canthus. In the globe's polar frame (theta from the axis about the
// globe's centre, h the height over the eye's surface radially: eye7_cycles.py's frame), per column the drawn lid's margin face is read
// from the scan's samples: theta_f(h) = the first angle beyond the lid's edge at which the skin stands h over the eye; the strip's rows lie
// 0.04 mm in front of that face (toward the opening) up to hS = min(the grey line's height grey x W, 0.9 x the lid's own margin hm, hm the
// skin's height within 0.6 mm of its edge). So it shows exactly as much margin as the lid has: none on a knife-edge lid, the strip on
// FACE7's lid tissue (the closed loop the Cycles rim keeps). Opaque mucosa to the meibomian row (orif x W), fading to the grey line (the
// keratinised margin is the lid's own skin, drawn by the face) and over the strip's top 30 %. Per vertex: rgb the record's mucosa (set when
// the record is in), a the band; the normal from the grid, out of the face (toward the opening).
function marginGeometry(eyes, seats, A, head, o) {
  const pos = [], col = [], idx = [], si = [], sw = [], rep = []; let base = 0;
  const R = A.globeR, rc = A.rc, rl = A.rl, NA = o.bins, nr = o.stripRows, ncol = 86, MA = A.margin, dl = 0.04;
  const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a))); return t * t * (3 - 2 * t); };
  eyes.forEach((e, n) => { const S = seats[n], zg = S.zg, zcc = S.zcc, oz = zg - zcc, z1 = eyeZ(A, zg, zcc);
    // the eye's front surface from the globe's centre along theta (the corneal bulge where it is in front: Cycles' ray_r)
    const rS = th => { const b = oz * Math.cos(th), c = oz * oz - rc * rc, tc = -b + Math.sqrt(Math.max(0, b * b - c)); return Math.max(R, Math.sin(th) * tc < rl ? tc : 0); };
    const edgeAt = deg => { const u = ((deg / 360) % 1 + 1) % 1 * NA, k0 = Math.floor(u) % NA, f = u - Math.floor(u); return S.edge[k0] * (1 - f) + S.edge[(k0 + 1) % NA] * f; };
    // the samples per bin in the polar frame: (theta, h)
    const P = S.S.map(arr => { const q = new Float64Array(arr.length); for (let i = 0; i < arr.length; i += 2) { const rho = arr[i], dz = arr[i + 1] - zg, th = Math.atan2(rho, dz); q[i] = th; q[i + 1] = Math.hypot(rho, dz) - rS(th); } return q; });
    for (const [lid, d0, d1] of [['low', 185, 355], ['up', 5, 175]]) { const W0 = MA[lid].W, hs = [];
      for (let c = 0; c < ncol; c++) { const t = c / (ncol - 1), deg = d0 + (d1 - d0) * t, al = deg * Math.PI / 180, f = Math.sin(Math.PI * t) ** 0.5;
        const W = W0 * (MA.taper + (1 - MA.taper) * f), Er = Math.min(edgeAt(deg), R - 0.5), the = Math.atan2(Er, z1(Er) - zg), k = Math.round(deg / 360 * NA) % NA;
        const sm = []; for (const d of [-1, 0, 1]) { const q = P[(k + d + NA) % NA]; for (let i = 0; i < q.length; i += 2) if (q[i] >= the - 0.15 / R && q[i] <= the + 1.0 / R) sm.push(q[i], q[i + 1]); }
        let hm = 0; for (let i = 0; i < sm.length; i += 2) if (sm[i] >= the && sm[i] <= the + 0.6 / R && sm[i + 1] > hm) hm = sm[i + 1];
        const hS = Math.min(MA.grey * W, 0.9 * hm) * f; hs.push(hS);
        const ux = e.side * Math.cos(al), uy = Math.sin(al); let thPrev = the - 0.15 / R;
        for (let j = 0; j < nr; j++) { const h = hS * j / (nr - 1);
          let thf = the + 0.6 / R; for (let i = 0; i < sm.length; i += 2) if (sm[i + 1] >= h && sm[i] < thf) thf = sm[i];
          thf = Math.max(thPrev, thf); thPrev = thf;
          const tv = thf - dl / R, rv = rS(tv) + h + 0.01, rho = rv * Math.sin(tv), z = zg + rv * Math.cos(tv);
          pos.push(e.c.x + ux * rho / 1000, e.c.y + uy * rho / 1000, e.c.z + z / 1000); si.push(head, 0, 0, 0); sw.push(1, 0, 0, 0);
          const a = (1 - sst(MA.orif * W, MA.grey * W, h)) * (1 - sst(0.7 * hS, hS, h)) * (hS > 0.05 ? 1 : 0);
          col.push(0.45, 0.22, 0.2, a); } }
      for (let c = 0; c < ncol - 1; c++) for (let j = 0; j < nr - 1; j++) { const a = base + c * nr + j, b = a + nr; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      base += ncol * nr;
      const mid = hs.slice(Math.floor(ncol / 4), Math.ceil(3 * ncol / 4)); rep.push({ side: e.side, lid, hS_mid_mm: +(mid.reduce((x, y) => x + y, 0) / mid.length).toFixed(2), hS_max_mm: +Math.max(...hs).toFixed(2), shown: hs.filter(v => v > 0.05).length / ncol }); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  // each triangle wound to face out of the margin's face, toward the opening (the eye's axis), then smooth normals
  const per = ncol * nr * 2, v3 = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  for (let t = 0; t < idx.length; t += 3) { const [a, b, c] = [v3(idx[t]), v3(idx[t + 1]), v3(idx[t + 2])], e = eyes[Math.floor(idx[t] / per)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2];
    const mx = (a[0] + b[0] + c[0]) / 3 - e.c.x, my = (a[1] + b[1] + c[1]) / 3 - e.c.y;
    if (nx * -mx + ny * -my < 0) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; } }
  g.setIndex(idx); g.computeVertexNormals();
  return { g, report: rep };
}

// ---------------------------------------------------------------- shaders
// (it 7) THE GAZE: each globe (globe, cornea, iris: this mesh) turned about the globe's centre (0, 0, zg) by e7Gz (eye -> head, Listing's law,
// computed per frame in onBeforeRender); the lids, meniscus and margin stay with the skin. vEL stays the vertex in the eye's OWN frame.
const VERT_PARS = `attribute vec4 aEye7L; varying vec4 vEL; varying vec3 vAxV, vUpV, vXV; uniform mat3 e7Gz0, e7Gz1; uniform vec4 e7Geo0, e7Geo1;
mat3 e7GzV() { return aEye7L.w > 0.0 ? e7Gz0 : e7Gz1; }
vec3 e7GzC() { return vec3(0.0, 0.0, (aEye7L.w > 0.0 ? e7Geo0.z : e7Geo1.z) * 0.001); }`;
const VERT_BEGIN = `transformed += e7GzV() * (aEye7L.xyz - e7GzC()) + e7GzC() - aEye7L.xyz;`;
const VERT_BEGNRM = `objectNormal = e7GzV() * objectNormal;`;
const VERT_NRM = `
#ifdef USE_SKINNING
vAxV = normalize(normalMatrix * (skinMatrix * vec4(e7GzV()[2], 0.0)).xyz); vUpV = normalize(normalMatrix * (skinMatrix * vec4(e7GzV()[1], 0.0)).xyz); vXV = normalize(normalMatrix * (skinMatrix * vec4(e7GzV()[0], 0.0)).xyz);
#else
vAxV = normalize(normalMatrix * e7GzV()[2]); vUpV = normalize(normalMatrix * e7GzV()[1]); vXV = normalize(normalMatrix * e7GzV()[0]);
#endif
vEL = aEye7L;`;
// the shell (both the globe and the lights' patch use it)
const SHELL = `
uniform sampler2D e7Lid; uniform vec4 e7Geo0, e7Geo1;   // (R, rc, zg, zcc) mm per eye
uniform mat3 e7Gz0, e7Gz1;   // (it 7) the gaze: eye -> head rotation per eye (about the globe's centre)
float eSide = 1.0; vec4 e7G = vec4(12.0, 7.8, 0.0, 5.0); mat3 e7Gz = mat3(1.0);
// (it 7) the lids are the skin's: a point and a direction of the turned eye's own frame, in the head-fixed frame the lids were read in
vec3 e7HeadP(vec3 P) { vec3 C = vec3(0.0, 0.0, e7G.z); return e7Gz * (P - C) + C; }
vec2 e7LidAt(float al) { vec4 t = textureLod(e7Lid, vec2(fract(al / 6.2831853 + 1.0), 0.5), 0.0); return eSide > 0.0 ? t.rg : t.ba; }
float e7ZEye(float rho) { float zs = e7G.z + sqrt(max(0.0, e7G.x * e7G.x - rho * rho)); float zc = rho < e7G.y ? e7G.w + sqrt(max(0.0, e7G.y * e7G.y - rho * rho)) : -1e9; return max(zs, zc); }
vec3 e7ToLocal(vec3 v) { return vec3(dot(v, vXV), dot(v, vUpV), dot(v, vAxV)); }
vec3 e7ToView(vec3 n) { return normalize(n.x * vXV + n.y * vUpV + n.z * vAxV); }
// the key's (or the room's) light from direction L reaching the point P on the eye past the lids as drawn: the ray toward L, followed in
// the axis' projection to the lid's edge, passes over the lid's top there or not; soft by the source's angular radius kap
float e7LidVis(vec3 P0, vec3 L0, float kap) {
  vec3 P = e7HeadP(P0), L = e7Gz * L0;
  float rhoP = length(P.xy); vec2 eP = e7LidAt(atan(P.y, P.x * eSide));
  float inside = smoothstep(0.0, 0.12, eP.x - rhoP);
  float lt = length(L.xy); if (lt < 1e-3 || L.z <= 0.0) return inside;
  vec2 u = L.xy / lt; float s = 0.0, e = eP.x;
  for (int k = 0; k < 3; k++) { float b = dot(P.xy, u), c = dot(P.xy, P.xy) - e * e; s = -b + sqrt(max(0.0, b * b - c)); vec2 Q = P.xy + s * u; e = e7LidAt(atan(Q.y, Q.x * eSide)).x; }
  vec2 Q = P.xy + s * u; vec2 lq = e7LidAt(atan(Q.y, Q.x * eSide));
  float t = s / lt, zRay = P.z + t * L.z, zLid = e7ZEye(lq.x) + lq.y, w = t * tan(kap) + 0.05;
  return inside * smoothstep(-w, w, zRay - zLid);
}
// the sky's share over P: each lid a wall of its height T at its distance d (the lid toward P's own azimuth and the one across)
float e7Sky(vec3 P0) {
  vec3 P = e7HeadP(P0); float rhoP = length(P.xy), al = atan(P.y, P.x * eSide); vec2 a = e7LidAt(al), b = e7LidAt(al + 3.14159265);
  float d1 = max(a.x - rhoP, 0.0), d2 = max(b.x + rhoP, 0.0);
  float o = 0.5 * a.y * a.y / (a.y * a.y + d1 * d1 + 1e-4) + 0.5 * b.y * b.y / (b.y * b.y + d2 * d2 + 1e-4);
  return clamp(1.0 - o, 0.0, 1.0) * smoothstep(0.0, 0.12, a.x - rhoP);
}
`;
const FRAG_PARS = `varying vec4 vEL; varying vec3 vAxV, vUpV, vXV;
uniform vec3 e7Cam0, e7Cam1; uniform vec4 e7Iris, e7Iris2, e7Lim, e7K, e7Tex; uniform vec3 e7Fundus, e7Angle;
uniform sampler2D e7IrisTex, e7ScleraTex;
` + SHELL + `
vec3 e7Q = vec3(0.0), e7NQ = vec3(0.0, 0.0, 1.0), e7NI = vec3(0.0, 0.0, 1.0), e7H = vec3(0.0); float e7IrisW = 0.0, e7SkyV = 1.0, e7Row = 0.0, e7LodI = 0.0;
// the iris surface's z at X (mm): the cone from the pupil margin (ACD behind the apex) to the root, + the relief (height in the atlas' alpha)
float e7IrisZ(vec3 X) {
  float r = length(X.xy), zA = e7G.w + e7G.y, pr = e7Iris.x, rr = e7Iris.y;
  if (r < pr) return zA - e7Iris.z;
  if (r > rr) return zA - e7Iris.w;
  float s = (r - pr) / (rr - pr), a = atan(X.y, X.x * eSide), hv = 0.5 / e7Tex.y;
  float h = textureLod(e7IrisTex, vec2(fract(a / 6.2831853 + 1.0), (e7Row + clamp(s, hv, 1.0 - hv)) * 0.5), e7LodI).a;
  return zA - e7Iris.z - (e7Iris.w - e7Iris.z) * pow(s, 1.2) + mix(e7Iris2.x, e7Iris2.y, h);
}
// (it 5) the light INTO the chamber: the entry point PE on the cornea whose refracted ray from the light (local unit L) lands on H, the
// refracted direction Ti there and the cosine ci of its incidence; false where no path exists (the light behind the cornea, or entering
// beyond the limbus: the sclera is opaque)
bool e7Entry(vec3 H, vec3 L, out vec3 PE, out vec3 Ti, out float ci) {
  vec3 Cc = vec3(0.0, 0.0, e7G.w), dir = L; float rc = e7G.y, eta = 1.0 / e7Iris2.z; PE = H; Ti = -L; ci = 0.0;
  for (int k = 0; k < 5; k++) {
    vec3 o = H - Cc; float b = dot(o, dir), D = b * b - (dot(o, o) - rc * rc); if (D < 0.0) return false;
    PE = H + dir * (-b + sqrt(D)); vec3 n = normalize(PE - Cc); ci = dot(n, L); if (ci <= 0.0) return false;
    Ti = refract(-L, n, eta); dir = -Ti; }
  float a = atan(PE.y, PE.x), cA = cos(a) / e7Lim.x, sA = sin(a) / e7Lim.y;
  return dot(PE.xy, PE.xy) * (cA * cA + sA * sA) < 1.0;
}
float e7Fres(float ci, float n) { float st2 = (1.0 - ci * ci) / (n * n); if (st2 >= 1.0) return 1.0; float ct = sqrt(1.0 - st2);
  float rs = (ci - n * ct) / (ci + n * ct), rp = (n * ci - ct) / (n * ci + ct); return 0.5 * (rs * rs + rp * rp); }
// the irradiance (in units of the light's own) on the iris at e7H from the directional light L: transmitted, concentrated by the cornea's
// lens (the beam's area across L at the entry over the iris area it lands on), shadowed by the lids at the entry, on the relief's own cosine
float e7IrisIrr(vec3 L, float kap) {
  vec3 PE, Ti, P1, T1, P2, T2; float ci, c1, c2, h = 0.06;
  if (!e7Entry(e7H, L, PE, Ti, ci)) return 0.0;
  float J = max(-Ti.z, 0.0);   // no neighbours: the flat iris's own cosine (no concentration)
  if (e7Entry(e7H + vec3(h, 0.0, 0.0), L, P1, T1, c1) && e7Entry(e7H + vec3(0.0, h, 0.0), L, P2, T2, c2)) {
    vec3 a = P1 - PE, b = P2 - PE; a -= L * dot(a, L); b -= L * dot(b, L); J = length(cross(a, b)) / (h * h); }
  J = min(J, 4.0);
  return (1.0 - e7Fres(ci, e7Iris2.z)) * J * e7LidVis(PE, L, kap) * saturate(dot(e7NI, -Ti)) / max(-Ti.z, 0.1);
}
// each directional light's direct irradiance at this fragment (a scalar, the cosine included): the white (and the pupil, the angle) at its
// own point past the shell, the iris through the cornea; the light loop then takes it along the shading normal
float e7Direct(vec3 Lv, float kap) {
  vec3 L = normalize(e7ToLocal(Lv)); float s = e7LidVis(e7Q, L, kap) * saturate(dot(e7NQ, L));
  return e7IrisW > 0.001 ? mix(s, e7IrisIrr(L, kap), e7IrisW) : s;
}
`;
// at roughnessmap_fragment: the surface, the iris, the sclera, the limbus
const FRAG = `
{ vec3 pI = vEL.xyz * 1000.0; eSide = vEL.w; bool sL = eSide > 0.0; e7G = sL ? e7Geo0 : e7Geo1; e7Gz = sL ? e7Gz0 : e7Gz1; vec3 cam = sL ? e7Cam0 : e7Cam1; e7Row = sL ? 0.0 : 1.0;
  float R = e7G.x, rc = e7G.y, zg = e7G.z, zcc = e7G.w;
  vec3 d = normalize(pI - cam), q = pI, nq = normalize(pI - vec3(0.0, 0.0, zg));
  { vec3 oc = cam - vec3(0.0, 0.0, zg); float b = dot(oc, d), D = b * b - (dot(oc, oc) - R * R); if (D > 0.0) { q = cam + d * (-b - sqrt(D)); nq = normalize(q - vec3(0.0, 0.0, zg)); }
    vec3 oc2 = cam - vec3(0.0, 0.0, zcc); float b2 = dot(oc2, d), D2 = b2 * b2 - (dot(oc2, oc2) - rc * rc);
    if (D2 > 0.0) { vec3 q2 = cam + d * (-b2 - sqrt(D2)); if (length(q2.xy) < e7Lim.x) { q = q2; nq = normalize(q2 - vec3(0.0, 0.0, zcc)); } } }
  e7Q = q; e7NQ = nq;
  float fw = max(length(dFdx(q)), length(dFdy(q))) + 1e-4;
  e7LodI = max(0.0, log2(fw / ((e7Iris.y - e7Iris.x) / e7Tex.y)) + e7K.w);
  float lodS = max(0.0, log2(fw / (R * 1.7453 / e7Tex.w)) + e7K.w);
  float rho = length(q.xy), al = atan(q.y, q.x * eSide), u = fract(al / 6.2831853 + 1.0), th = atan(rho, q.z - zg);
  float cA = cos(al) / e7Lim.x, sA = sin(al) / e7Lim.y, rhoL = 1.0 / sqrt(cA * cA + sA * sA), thL = asin(min(0.99, rhoL / R));
  float aS = clamp((th - thL) * R / e7Lim.z, 0.0, 1.0);
  // the iris: the view ray refracted at the cornea and marched to the stroma's surface
  vec3 nC = normalize(q - vec3(0.0, 0.0, zcc)), tr = refract(d, nC, 1.0 / e7Iris2.z);
  float zA = zcc + rc, lam1 = max(0.0, (q.z - (zA - e7Iris.w - 0.45)) / max(-tr.z, 0.05)), lo = 0.0, hi = lam1, lp = 0.0; bool hit = false;
  for (int k = 1; k <= E7_STEPS; k++) { float lam = lam1 * float(k) / float(E7_STEPS); vec3 X = q + tr * lam;
    if (X.z - e7IrisZ(X) < 0.0) { lo = lp; hi = lam; hit = true; break; } lp = lam; }
  if (hit) for (int k = 0; k < 5; k++) { float m = 0.5 * (lo + hi); vec3 X = q + tr * m; if (X.z - e7IrisZ(X) < 0.0) hi = m; else lo = m; }
  vec3 H = q + tr * hi; e7H = H; float rH = length(H.xy), pr = e7Iris.x, rr = e7Iris.y;
  float s = clamp((rH - pr) / (rr - pr), 0.0, 1.0), aH = atan(H.y, H.x * eSide), hv = 0.5 / e7Tex.y;
  vec3 irisC = textureLod(e7IrisTex, vec2(fract(aH / 6.2831853 + 1.0), (e7Row + clamp(s, hv, 1.0 - hv)) * 0.5), e7LodI).rgb;
  float pupil = smoothstep(pr + 0.03, pr - 0.03, rH), root = hit ? smoothstep(rr - 0.08, rr + 0.12, rH) : 1.0;
  vec3 thr = mix(mix(irisC, e7Angle, root), e7Fundus, pupil);
  // the stroma's normal from its relief (radial and circumferential slopes)
  { vec3 er = rH > 1e-3 ? vec3(H.xy / rH, 0.0) : vec3(1.0, 0.0, 0.0), et = vec3(-er.y, er.x, 0.0); float ep = 0.03;
    float dzr = (e7IrisZ(H + er * ep) - e7IrisZ(H - er * ep)) / (2.0 * ep), dzt = (e7IrisZ(H + et * ep) - e7IrisZ(H - et * ep)) / (2.0 * ep);
    e7NI = normalize(vec3(0.0, 0.0, 1.0) - er * dzr - et * dzt); }
  e7IrisW = (1.0 - aS) * (1.0 - pupil) * (1.0 - root);
  // the sclera: its grown map, the opaque bevel over the clear cornea
  float hs = 0.5 / e7Tex.w; vec3 scl = textureLod(e7ScleraTex, vec2(u, (e7Row + clamp(th / e7Lim.w, hs, 1.0 - hs)) * 0.5), lodS).rgb;
  diffuseColor.rgb = mix(thr, scl, aS); roughnessFactor = mix(0.6, 0.45, aS);
  e7SkyV = e7Sky(q);
}`;
const NORMAL = `
{ normal = normalize(mix(e7ToView(e7NQ), e7ToView(e7NI), e7IrisW)); }`;
const CC_NORMAL = `
#ifdef USE_CLEARCOAT
clearcoatNormal = e7ToView(e7NQ);
#endif`;
const F0 = `
#ifdef USE_CLEARCOAT
material.clearcoatF0 = vec3(e7K.y); material.clearcoatF90 = 1.0;
#endif`;
// the directional lights' loop: each light's direct irradiance (e7Direct: the white past the shell at its point; the iris through the cornea,
// refracted), taken along the shading normal (the clearcoat's direct specular is the DISC's, written after the loop)
const DIR_ANCHOR = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
function patchLights(chunk, call) {
  const i0 = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'); if (i0 < 0) return null;
  const i1 = chunk.indexOf(DIR_ANCHOR, i0); if (i1 < 0) return null;
  return chunk.slice(0, i1) + call + '\n\t\t' + chunk.slice(i1);
}
// the key as the area source it is, reflected in a smooth film of Fresnel F0 (FACE5's analytic disc, the film's own F0, no gain): written
// into `target`, the film's normal `nrm`; each directional light's disc shadowed by its shadow map and by `vis` (GLSL of L, the light's
// view-space direction)
const DISC = (target, nrm, f0, kap, vis) => `
#if NUM_DIR_LIGHTS > 0
{ vec3 cRr = reflect(-geometryViewDir, ${nrm}); float cFr = ${f0} + (1.0 - ${f0}) * pow(1.0 - saturate(dot(${nrm}, geometryViewDir)), 5.0);
  float cK = ${kap}, cOm = 6.2831853 * (1.0 - cos(cK)); ${target} = vec3(0.0);
  DirectionalLight cDL;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow cDS;
  #endif
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    { cDL = directionalLights[ i ]; float cSh = 1.0;
    #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
    cDS = directionalLightShadows[ i ];
    cSh = receiveShadow ? getShadow( directionalShadowMap[ i ], cDS.shadowMapSize, cDS.shadowIntensity, cDS.shadowBias, cDS.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
    #endif
    vec3 L = cDL.direction; float cDisc = smoothstep(cos(cK * 1.15), cos(cK * 0.85), dot(cRr, L));
    ${target} += cDL.color * cSh * cDisc * cFr / cOm * (${vis}); }
  }
  #pragma unroll_loop_end
}
#endif
`;
const LIGHT_END_GLOBE = DISC('clearcoatSpecularDirect', 'geometryClearcoatNormal', 'e7K.y', 'e7K.x', 'e7LidVis(e7Q, normalize(e7ToLocal(L)), cK)')
  .replace('#if NUM_DIR_LIGHTS > 0', '#if defined( USE_CLEARCOAT ) && ( NUM_DIR_LIGHTS > 0 )');
const AMBIENT = `
reflectedLight.indirectDiffuse *= e7SkyV;
#ifdef USE_CLEARCOAT
{ vec3 rv = reflect(-geometryViewDir, geometryClearcoatNormal); clearcoatSpecularIndirect *= e7LidVis(e7Q, normalize(e7ToLocal(rv)), 0.35); }
#endif`;
// the meniscus: water (F0 from n 1.336) added over what lies behind it; its disc on the base specular
const MEN_PARS = `uniform vec4 e7M;`;   // (key half-angle, F0)
const MEN_END = DISC('reflectedLight.directSpecular', 'geometryNormal', 'e7M.y', 'e7M.x', '1.0');
// (it 4) the wet margin: mucosa under the tear film (the film's F0 on the clearcoat, the key's disc on it); a face standing on the eye sees
// the eye over half its hemisphere (a wall on a plane: cosine-weighted, exactly half), so its sky and the room's reflection are halved
const STRIP_PARS = `uniform vec4 e7S;`;   // (key half-angle, F0)
const STRIP_F0 = `
#ifdef USE_CLEARCOAT
material.clearcoatF0 = vec3(e7S.y); material.clearcoatF90 = 1.0;
#endif`;
const STRIP_END = DISC('clearcoatSpecularDirect', 'geometryClearcoatNormal', 'e7S.y', 'e7S.x', '1.0').replace('#if NUM_DIR_LIGHTS > 0', '#if defined( USE_CLEARCOAT ) && ( NUM_DIR_LIGHTS > 0 )');
const STRIP_AMB = `
reflectedLight.indirectDiffuse *= 0.5;
#ifdef USE_CLEARCOAT
clearcoatSpecularIndirect *= 0.5;
#endif`;

// ---------------------------------------------------------------- the build
export function buildEye7(h, o, { fitEyes, wetParts, IRIS }) {
  const e7 = { ...ENGINE7, ...(o.eye7 && typeof o.eye7 === 'object' ? o.eye7 : {}) };
  const ageK = Math.max(0.1, Math.min(0.95, h.o.age ?? 0.3)), age = e7.age ?? +(20 + (ageK - 0.1) / 0.85 * 50).toFixed(1), sex = h.sex === 'f' ? 'f' : 'm';
  const cls = typeof o.iris === 'string' && IRIS_PIG[o.iris] ? o.iris : 'brown';
  const stage = String(e7.stage ?? 'studio').split('@')[0];
  const seed = e7.seed != null ? e7.seed % 100000 : eye7Seed({ skin: h.o.skin, height: h.o.height, age: h.o.age, sex: h.sex });   // (v11) the one seed (index.js), as Cycles'
  const A = eyeAnatomy({ age, sex }), kap = Math.max(1.5, o.f5?.keyDeg ?? 11) * Math.PI / 180;
  const eyes = fitEyes(h, { globeR: A.globeR / 1000 });
  const seats = eyes.map(e => seatEye(h, e, A, e7));
  const zcc0 = Math.sqrt(A.globeR ** 2 - A.rl ** 2) - Math.sqrt(A.rc ** 2 - A.rl ** 2);
  eyes.forEach((e, n) => { const S = seats[n]; Object.assign(e, { r: A.globeR / 1000, rc: A.rc / 1000, rl: A.rl / 1000, zcc: zcc0 / 1000, inset: S.inset / 1000, thL: Math.asin(A.rl / A.globeR), zApex: (zcc0 + A.rc) / 1000 }); });
  const head = h.idx.head, g = globeGeometry(eyes, seats, A, head);
  const ic = IRIS[cls] || IRIS.brown;
  const U = {
    e7Cam0: { value: new THREE.Vector3() }, e7Cam1: { value: new THREE.Vector3() }, e7Gz0: { value: new THREE.Matrix3() }, e7Gz1: { value: new THREE.Matrix3() },
    e7Geo0: { value: new THREE.Vector4(A.globeR, A.rc, seats[0].zg, seats[0].zcc) }, e7Geo1: { value: new THREE.Vector4(A.globeR, A.rc, seats[1].zg, seats[1].zcc) },
    e7Iris: { value: new THREE.Vector4(1.5, A.irisRootR, A.acd, A.irisRootDepth) }, e7Iris2: { value: new THREE.Vector4(e7.hRange[0], e7.hRange[1], A.nCornea, 0) },
    e7Lim: { value: new THREE.Vector4(A.rl, A.rlv, ANAT.limbus.band, THETA_MAX) },
    e7K: { value: new THREE.Vector4(kap, f0Of(A.nTear), 0, 0) },   // the key's half-angle, the tear film's F0, ready, the maps' lod bias
    e7Tex: { value: new THREE.Vector4(e7.irisRes[0], e7.irisRes[1], e7.scleraRes[0], e7.scleraRes[1]) },
    e7Fundus: { value: new THREE.Vector3(...e7.fundus) }, e7Angle: { value: new THREE.Vector3(0.01, 0.007, 0.005) },
    e7IrisTex: { value: blank() }, e7ScleraTex: { value: blank() }, e7Lid: { value: lidTexture(seats, e7.bins) },
    // (the export's legacy fields: person/export.js writes them; the Cycles eye7 reads the record instead)
    eBase: { value: new THREE.Vector3(...ic.base) }, eFibre: { value: new THREE.Vector3(...ic.fibre) }, eCenter: { value: new THREE.Vector3(...ic.center) }, eLimbus: { value: new THREE.Vector3(...ic.limbus) },
  };
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, specularIntensity: 0, clearcoat: 1, clearcoatRoughness: e7.tearRough });
  const lightsDir = patchLights(THREE.ShaderChunk.lights_fragment_begin, 'directLight.color *= e7Direct(directLight.direction, e7K.x); directLight.direction = geometryNormal;');
  if (!lightsDir) console.warn('eye7: the directional lights\' loop anchor was not found; the lids\' shadow on the eye is off');
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U); sh.defines = { ...(sh.defines || {}), E7_STEPS: e7.steps };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n' + VERT_NRM)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + VERT_BEGNRM).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BEGIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + NORMAL)
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\n' + CC_NORMAL)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + F0)
      .replace('#include <lights_fragment_begin>', lightsDir || '#include <lights_fragment_begin>')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + LIGHT_END_GLOBE)
      .replace('#include <aomap_fragment>', AMBIENT + '\n#include <aomap_fragment>');
  };
  mat.customProgramCacheKey = () => 'eye7-globe-v' + EYE7_VERSION + '-s' + e7.steps;
  const mesh = new THREE.SkinnedMesh(g, mat); mesh.frustumCulled = false; mesh.bind(h.skeleton, new THREE.Matrix4());
  mesh.userData.subject = 1; mesh.userData.part = 'eye'; mesh.castShadow = false; mesh.receiveShadow = true;
  const Mh = new THREE.Matrix4(), Mi = new THREE.Matrix4(), cw = new THREE.Vector3(), tw = new THREE.Vector3();
  const gaze = { t: null, limit: e7.gazeLimit, now: [] };
  mesh.onBeforeRender = (r, s, cam) => {
    const Bn = h.skeleton.bones[head]; Mh.multiplyMatrices(Bn.matrixWorld, h.skeleton.boneInverses[head]); Mi.copy(Mh).invert();
    cw.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(Mi);
    // (it 7) the gaze target in the head's bind frame (m): the camera, a world point, a head direction, or none (primary position)
    const G = gaze.t; let tg = null;
    if (G === 'camera') tg = cw; else if (G && G.isVector3) tg = tw.copy(G).applyMatrix4(Mi);
    eyes.forEach((e, k) => { const zg = seats[k].zg, c = [(cw.x - e.c.x) * 1000, (cw.y - e.c.y) * 1000, (cw.z - e.c.z) * 1000];
      let d = null; if (tg) d = [(tg.x - e.c.x) * 1000, (tg.y - e.c.y) * 1000, (tg.z - e.c.z) * 1000 - zg]; else if (G && G.dir) d = G.dir;
      const L = listingRotation(d, gaze.limit), Rm = L.R;
      U['e7Gz' + k].value.set(Rm[0], Rm[1], Rm[2], Rm[3], Rm[4], Rm[5], Rm[6], Rm[7], Rm[8]);
      // the camera in the turned eye's own frame: R^T (c - C) + C, C the globe's centre (0, 0, zg)
      const v = [c[0], c[1], c[2] - zg]; U['e7Cam' + k].value.set(Rm[0] * v[0] + Rm[3] * v[1] + Rm[6] * v[2], Rm[1] * v[0] + Rm[4] * v[1] + Rm[7] * v[2], Rm[2] * v[0] + Rm[5] * v[1] + Rm[8] * v[2] + zg);
      gaze.now[k] = { side: e.side, deg: +L.deg.toFixed(2), clamped: L.clamped, head_deg: +(L.target - L.deg).toFixed(2), yaw_deg: +(Math.atan2(Rm[2], Rm[8]) * 180 / Math.PI).toFixed(2), pitch_deg: +(Math.asin(Math.max(-1, Math.min(1, Rm[5]))) * 180 / Math.PI).toFixed(2) }; });
  };
  if (h.eyes) h.eyes.visible = false;
  h.group.add(mesh); h.meshes.push(mesh);
  // the wet line: the lower meniscus
  const extra = [];
  { const mg = meniscusGeometry(eyes, seats, A, head, e7), UM = { e7M: { value: new THREE.Vector4(kap, f0Of(A.nTear), 0, 0) } };
    const mm = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, metalness: 0, ior: A.nTear, specularIntensity: 1, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    mm.onBeforeCompile = sh => { Object.assign(sh.uniforms, UM); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + MEN_PARS).replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + MEN_END); };
    mm.customProgramCacheKey = () => 'eye7-meniscus-v' + EYE7_VERSION;
    const m = new THREE.SkinnedMesh(mg, mm); m.frustumCulled = false; m.bind(h.skeleton, new THREE.Matrix4()); m.userData.subject = 1; m.userData.part = 'eye-meniscus'; m.castShadow = false; m.receiveShadow = false;
    m.renderOrder = 2; h.group.add(m); h.meshes.push(m); extra.push(m); }
  // (it 4) the wet margin on the lids as drawn (the posterior lid margin's mucosa; its colour from the record once the skin model is in)
  const strip = marginGeometry(eyes, seats, A, head, e7);
  { const US = { e7S: { value: new THREE.Vector4(kap, f0Of(A.nTear), 0, 0) } };
    const sm = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0, specularIntensity: 0.5, clearcoat: 1, clearcoatRoughness: e7.tearRough,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    sm.onBeforeCompile = sh => { Object.assign(sh.uniforms, US); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + STRIP_PARS)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + STRIP_F0)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + STRIP_END)
      .replace('#include <aomap_fragment>', STRIP_AMB + '\n#include <aomap_fragment>'); };
    sm.customProgramCacheKey = () => 'eye7-margin-v' + EYE7_VERSION;
    const m = new THREE.SkinnedMesh(strip.g, sm); m.frustumCulled = false; m.bind(h.skeleton, new THREE.Matrix4()); m.userData.subject = 1; m.userData.part = 'eye-margin'; m.castShadow = false; m.receiveShadow = true;
    m.renderOrder = 1; h.group.add(m); h.meshes.push(m); extra.push(m); }
  seats.forEach(q => { delete q.S; });   // the scan's samples were needed only here
  // the caruncle (FACE3's mound at the landmark canthus), its colour from the record once the skin model is in
  if (o.wet?.canthus) extra.push(...wetParts(h, eyes, { caruncle: true, canthus: o.wet.canthus, car7: { col: [0.5, 0.2, 0.19], scale: 1 } }, head));
  const opt = { iris: cls, pupil: 3, age: h.o.age ?? 0.3, stage, seed, eye7: e7, ...(o.pig ? { pig: o.pig } : {}) };   // (integrator c6 seam) the export carries pig to Cycles
  const E = { mesh, U, eyes, opt, extra, rev: 7, version: EYE7_VERSION, seats: seats.map(s => s.report), margin: strip.report, record: null,
    set: (q = {}) => { if (q.pupil != null) { opt.pupil = q.pupil; U.e7Iris.value.x = q.pupil / 2; } if (q.gaze !== undefined) E.look(q.gaze); },
    // (it 7) THE GAZE: 'camera' (the portrait's sitter: the default) | 'ahead' | a world point (THREE.Vector3) | { yaw, pitch } (degrees, the
    // head's frame: + yaw toward the head's +x, + pitch up); applied each frame (both eyes fixate a point: vergence from the geometry)
    look: (t) => { if (t === 'ahead' || t == null || t === 'none') gaze.t = null; else if (t === 'camera' || (t && t.isVector3)) gaze.t = t;
      else if (Array.isArray(t)) gaze.t = new THREE.Vector3(...t);
      else if (typeof t === 'object') { const y = (t.yaw || 0) * Math.PI / 180, p = (t.pitch || 0) * Math.PI / 180; gaze.t = { dir: [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)] }; }
      return E; },
    gaze,
    off: () => { mesh.visible = false; for (const m of extra) m.visible = false; if (h.eyes) h.eyes.visible = true; } };
  // the record and the maps (the studio's skin model: applySkin has loaded it before the eyes, so this resolves in the same build)
  const fill = M => { const t0 = Date.now();
    const R = eye7Record(M, { age, sex, iris: cls, seed, skin: h.likeness?.skin?.person || null, irisRes: e7.irisRes, scleraRes: e7.scleraRes, pig: o.pig || null });   // (integrator c6 seam) o.pig: the person's own pigment (person/iris7.js)
    const pd = R.json.pupil[stage] ?? R.json.pupil.studio; opt.pupil = pd; U.e7Iris.value.x = pd / 2;
    U.e7IrisTex.value = irisAtlas(R.maps, e7.hRange); U.e7ScleraTex.value = scleraAtlas(R.maps);
    const ru = R.json.colours.ruff; U.e7Angle.value.set(ru[0], ru[1], ru[2]); U.e7K.value.z = 1;
    for (const m of extra) if (m.userData.part === 'eye-caruncle') { const c = R.json.colours.caruncle; m.material.color.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace); }
    for (const m of extra) if (m.userData.part === 'eye-margin') { const c = R.json.colours.margin, a = m.geometry.attributes.color;
      for (let v = 0; v < a.count; v++) a.setXYZ(v, c[0], c[1], c[2]); a.needsUpdate = true; }
    E.record = R.json; E.ms = Date.now() - t0; delete R.maps; return E; };
  E.ready = loadSkinModel().then(fill).catch(err => { console.warn('eye7: ' + (err.message || err)); E.error = String(err.message || err); return E; });
  E.look(e7.gaze);
  h.likeness = { ...(h.likeness || {}), eyes: E };
  return E;
}
