// FACE5 (HUMAN c8 round 5, 3 Oct, judge c10 step 2): face rev 6 = FACE4's rev 4 + MOUTH + this, on a v4 person at page time (no re-bake).
// Opt-in: only face3Spec(info, { rev: 4, mouth: {}, f5: {} }) (or rev: 6) reaches this file: makePerson('v4:<name>', { face3: { f5: {} } }).
// Without `f5` every person, bake, lab and scene renders exactly as before (face5_test.mjs checks positions, specs and hook keys).
//
//  1. AGE. FACE4's identity basis (ten scans, three of them 60-64) and the x10 retune hollowed young cheeks (L08 F24: malar and buccal
//     ~1 mm under v3, probe), and SKIN4's measured zones (the same ten scans) darken the periorbital skin, the mouth corners and the
//     nasolabial line at the scans' median age. So, by the person's age, a GATE g(age) = floor + (1 - floor) smoothstep(30, 50, age)
//     (floor 0.45: a 24-year-old carries 0.45 of the creases a 50-year-old does) scales:
//       - geometry: the crease bands (nasolabial, the tear trough and lower lid, the marionette line) are relaxed along the normal (a
//         masked Laplacian) until their depth (mean |normal Laplacian|) is g of the person's own, MakeHuman's eye-bag-decr at (1 - g)
//         scaled, and the young midface's fat back (cheek volume, bones and lift, ~1 mm at 24);
//       - skin: SKIN4's periorbital and perioral zones (under-eye, inner canthus, upper lid, mouth corners, nasolabial) at g in log
//         (zones4.js zoneWeights; the face's mean divided out again, so the person's colour stays the preset), the deoxygenated (blue)
//         share likewise, lane B's age lines (forehead, crow's feet, under-eye arcs) x g;
//       - the lower lashes off (lane D draws ten a lid, each a 1 mm card 3-4 mm long that reads as a dark dash on the cheek under the
//         raised lid at 1:1: the 'bags'; HAIR's finer lower lashes are the real fix).
//     Measured: REFS c3's modern women (age_read.py, local only): the under-eye patch's fine texture rises from 2.9 (20-29, n 37) to
//     4.7-5.3 (50+): the twenties carry ~0.55-0.6 of it, hence the floor.
//  2. A PLEASANT FACE AT REST, seeded per person (tone 0.45..1, so a row does not smile in unison): the zygomaticus' tone (hero.js's
//     mouth-corner-puller, the corners up to at most 2.6 mm over the stomion at rest, 4.4 in the slight smile), the cheeks lifted with it
//     (cheek-trans-up), a trace of the lower lid's raise (eye-*-slit). Never a grin. kind: 'neutral' (nothing) | 'rest' | 'smile'.
//     And the mouth SYMMETRISED (the perioral region and the nose's base blended toward their mirror image, 0.8 / 0.6): FACE4's basis
//     keeps 35 % of the scans' asymmetry and P2 draws its own; on L20 it tilted the mouth and on L23 it raised one side of the upper lip.
//  3. LIPS (an H1 hook after MOUTH's): the vermilion's vertical lines in the NORMAL, wide enough to resolve at 1:1 (lane B's fissures fade
//     below ~0.2 mm a pixel), a wet band on the lower lip just under the meeting line (a sharp lobe), the vermilion border softened
//     (MOUTH's and lane B's edge widths, live uniforms).
//  4. EYES (eyes.js `f5`): the tear line (the meniscus strip wet and bright), a CATCHLIGHT that follows the stage's key (each directional
//     light's disc, of the key's angular size, reflected in the cornea: radiance E / solid angle x the tear film's Fresnel, shadowed by
//     the shadow map like the key), the caruncle wetter.
import { clamp, rng, hashStr } from './sample.js';
import { zoneWeights } from '../likeness/zones4.js';

export const FACE5_VERSION = 1;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const at = (P, v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];

export const F5_DEFAULTS = {
  age: { lo: 30, hi: 50, floor: 0.45, relax: 10, fill: { f: 1.0, m: 0.6 }, bag: 0.5, zones: ['underEye', 'innerCanthus', 'upperLid', 'mouthCorner', 'nasolabial'], zoneFloor: 0.5, lines: true, lowerLashes: 0 },
  rest: { kind: null, tone: null, corner: { rest: 1.2, smile: 2.8 }, cap: { rest: 2.6, smile: 4.4 }, cheek: { rest: 0.32, smile: 0.6 }, slit: { rest: 0.07, smile: 0.15 } },
  sym: { mouth: 0.8, nose: 0.6 },
  lips: { fissure: 1, wet: 1, soft: 0.0007 },
  eyes: { tear: 1, catch: 2, keyDeg: 11, caruncle: 1 },   // catch: x the tear film's Fresnel reflection of the key's disc (1 = physical; see eyes.js)
};
const merge = (a, b) => b === false ? false : { ...a, ...(typeof b === 'object' ? b : {}) };
export const ageGate = (age, o = F5_DEFAULTS.age) => o.floor + (1 - o.floor) * sst(o.lo, o.hi, age ?? 35);

// face5Spec(info, o): o = the face3 options; o.f5 = {} | { age, rest, sym, lips, eyes } (each false = that part off)
export function face5Spec(info, o = {}) {
  const f5 = typeof o.f5 === 'object' ? o.f5 : {}, r = rng((hashStr('face5:' + (info.name || '')) ^ Math.imul((o.seed ?? 1) + 11, 2654435761)) >>> 0);
  const u = r(), age = merge(F5_DEFAULTS.age, f5.age), rest = merge(F5_DEFAULTS.rest, f5.rest);
  if (rest) { rest.kind = rest.kind ?? 'rest'; rest.tone = rest.tone ?? +(0.45 + 0.55 * u).toFixed(3); }
  const g = age ? ageGate(info.age, age) : 1;
  return { v: FACE5_VERSION, name: info.name, sex: info.sex === 'm' ? 'm' : 'f', age: info.age ?? 35, gate: +g.toFixed(3), youth: +((1 - g) / (1 - (age?.floor ?? 0.45))).toFixed(3),
    ageO: age, rest, sym: merge(F5_DEFAULTS.sym, f5.sym), lips: merge(F5_DEFAULTS.lips, f5.lips), eyes: merge(F5_DEFAULTS.eyes, f5.eyes) };
}

// ---------------------------------------------------------------- geometry
function addTarget(F, P, name, w, k, n) { if (!w) return 0; const t = F.target(name); if (!t) return 0; const { ix, d } = t; let mx = 0;
  for (let i = 0; i < ix.length; i++) { const v = ix[i]; if (v >= n) continue; const q = v * 3; P[q] += w * k * d[i * 3]; P[q + 1] += w * k * d[i * 3 + 1]; P[q + 2] += w * k * d[i * 3 + 2];
    mx = Math.max(mx, Math.abs(w * k) * Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2])); }
  return mx; }
const tiltOf = (P, I) => (0.5 * (P[I.ch_L * 3 + 1] + P[I.ch_R * 3 + 1]) - P[I.sto * 3 + 1]) * 1000;
const asymOf = (P, I) => (P[I.ch_L * 3 + 1] - P[I.ch_R * 3 + 1]) * 1000;
function segDist(p, a, b) { const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  const t = clamp((w[0] * e[0] + w[1] * e[1] + w[2] * e[2]) / Math.max(ee, 1e-12)); return Math.hypot(w[0] - t * e[0], w[1] - t * e[1], w[2] - t * e[2]); }
function vnorm(P, tri, nb) { const N = new Float32Array(nb * 3);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= nb || b >= nb || c >= nb) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; } }
  for (let v = 0; v < nb; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; } return N; }

// the crease bands (bind metres, from the person's own landmarks): nasolabial, tear trough + lower lid skin, marionette; 0 on the lips,
// the lid margins and the nostrils
export function creaseMask(P, I, nb) {
  const L = k => at(P, I[k]), sto = L('sto'), half = Math.abs(L('ch_L')[0] - L('ch_R')[0]) / 2, mm = 0.001, M = new Float32Array(nb), z0 = sto[2] - 0.03;
  const bands = [];
  for (const s of ['L', 'R']) { const sg = Math.sign(L('ch_' + s)[0]) || 1, al = L('al_' + s), ch = L('ch_' + s), pi = L('pi_' + s), en = L('en_' + s);
    const off = (p, dx, dy, dz = 0) => [p[0] + sg * dx * mm, p[1] + dy * mm, p[2] + dz * mm];
    bands.push({ k: 'nl', poly: [off(al, 3, 1), off(ch, 6, -2), off(ch, 8.5, -14)], sig: 4.5 * mm },
      { k: 'tear', poly: [off(en, 1, -4), off(en, 6, -13), off(pi, 9, -9)], sig: 3.5 * mm, below: pi[1] - 2.8 * mm },
      { k: 'lid', poly: [off(pi, -7, -6.5), off(pi, 0, -7.5), off(pi, 9, -6)], sig: 3.5 * mm, below: pi[1] - 2.8 * mm },
      { k: 'mar', poly: [off(ch, 1.5, -4), off(ch, 3.5, -16)], sig: 3.2 * mm }); }
  for (let v = 0; v < nb; v++) { const p = at(P, v); if (p[2] < z0 || p[1] > L('g')[1]) continue; let w = 0;
    for (const b of bands) { if (Math.sign(p[0]) !== Math.sign(b.poly[0][0]) && Math.abs(p[0]) > 0.004) continue; let d = Infinity; for (let i = 0; i + 1 < b.poly.length; i++) d = Math.min(d, segDist(p, b.poly[i], b.poly[i + 1]));
      let m = Math.exp(-0.5 * (d / b.sig) ** 2); if (b.below != null) m *= sst(b.below, b.below - 2 * mm, p[1]); w = Math.max(w, m); }
    if (!w) continue;
    // out: the lips (an ellipse round the mouth), the nostrils (round the subnasale), the eyes' fissures
    const lx = Math.abs(p[0] - sto[0]) / (half + 2.5 * mm), ly = (p[1] - sto[1]) / (8.5 * mm); w *= sst(0.85, 1.25, Math.hypot(lx, ly));
    const sn = L('sn'); w *= sst(5 * mm, 9 * mm, Math.hypot(p[0] - sn[0], (p[1] - sn[1]) * 1.4));
    M[v] = w; }
  return M;
}
function laplaceRelax(P, N, M, adj, iters, lam) {
  const idx = []; for (let v = 0; v < M.length; v++) if (M[v] > 0.01) idx.push(v);
  const D = new Float32Array(M.length * 3);
  for (let it = 0; it < iters; it++) { for (const v of idx) { const a = adj[v]; if (!a || !a.length) continue; let sx = 0, sy = 0, sz = 0; for (const u of a) { sx += P[u * 3]; sy += P[u * 3 + 1]; sz += P[u * 3 + 2]; }
      const dn = ((sx / a.length - P[v * 3]) * N[v * 3] + (sy / a.length - P[v * 3 + 1]) * N[v * 3 + 1] + (sz / a.length - P[v * 3 + 2]) * N[v * 3 + 2]) * lam * M[v];
      D[v * 3] = dn * N[v * 3]; D[v * 3 + 1] = dn * N[v * 3 + 1]; D[v * 3 + 2] = dn * N[v * 3 + 2]; }
    for (const v of idx) { P[v * 3] += D[v * 3]; P[v * 3 + 1] += D[v * 3 + 1]; P[v * 3 + 2] += D[v * 3 + 2]; } }
}
// the crease depth read: mean |normal Laplacian| (mm) over a band's vertices (the fold's curvature, ring-averaged)
function creaseRead(P, N, M, adj, thr = 0.5) { let s = 0, c = 0;
  for (let v = 0; v < M.length; v++) { if (M[v] < thr) continue; const a = adj[v]; if (!a?.length) continue; let sx = 0, sy = 0, sz = 0; for (const u of a) { sx += P[u * 3]; sy += P[u * 3 + 1]; sz += P[u * 3 + 2]; }
    s += Math.abs((sx / a.length - P[v * 3]) * N[v * 3] + (sy / a.length - P[v * 3 + 1]) * N[v * 3 + 1] + (sz / a.length - P[v * 3 + 2]) * N[v * 3 + 2]); c++; }
  return c ? +(s / c * 1e6).toFixed(1) : null; }   // micrometres

// face5Shape(F, P, ctx, spec) -> { P, report }: ctx = { nb, n, tri, expr, L (the scan library: its mirror map) }; positions in bind metres
export function face5Shape(F, P0, ctx, spec) {
  const I = F.ids, { nb, n, tri, expr, L } = ctx, P = new Float32Array(P0), R = { gate: spec.gate, youth: spec.youth }, k = (P[I.v * 3 + 1] - P[I.me * 3 + 1]) / (F.lm.baseHeadHeightDm || 2.3358);
  const adj = Array.from({ length: nb }, () => null); { const S = Array.from({ length: nb }, () => new Set());
    for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= nb || b >= nb || c >= nb) continue; S[a].add(b).add(c); S[b].add(a).add(c); S[c].add(a).add(b); }
    for (let v = 0; v < nb; v++) if (S[v].size) adj[v] = Int32Array.from(S[v]); }
  R.tilt0 = +tiltOf(P, I).toFixed(2); R.asym0 = +asymOf(P, I).toFixed(2);
  // 1. symmetry: the perioral region and the nose's base toward their mirror image (the scan library's mirror map on hm08's head)
  if (spec.sym && L?.mirror) { const inv = new Int32Array(n).fill(-1); for (let v = 0; v < L.k; v++) inv[L.hv[v]] = v;
    const sto = at(P, I.sto), sn = at(P, I.sn), half = Math.abs(P[I.ch_L * 3] - P[I.ch_R * 3]) / 2, Q = new Float32Array(P); let mx = 0;
    for (let g = 0; g < nb; g++) { const j = inv[g]; if (j < 0) continue; const gm = L.hv[L.mirror[j]]; if (gm == null || gm >= nb) continue;
      const x = P[g * 3], y = P[g * 3 + 1], z = P[g * 3 + 2]; if (z < sto[2] - 0.035) continue;
      const wm = spec.sym.mouth * Math.exp(-0.5 * ((x / (half + 0.012)) ** 2 + ((y - sto[1]) / 0.016) ** 2)), wn = spec.sym.nose * Math.exp(-0.5 * ((x / 0.022) ** 2 + ((y - sn[1]) / 0.012) ** 2));
      const w = Math.max(wm, wn); if (w < 0.01) continue;
      const sx = 0.5 * (x - P[gm * 3]), sy = 0.5 * (y + P[gm * 3 + 1]), sz = 0.5 * (z + P[gm * 3 + 2]);
      Q[g * 3] = x + w * (sx - x); Q[g * 3 + 1] = y + w * (sy - y); Q[g * 3 + 2] = z + w * (sz - z); mx = Math.max(mx, w * Math.hypot(sx - x, sy - y, sz - z)); }
    P.set(Q); R.sym = { maxMm: +(mx * 1000).toFixed(2), asym: +asymOf(P, I).toFixed(2) }; }
  // 2. age: the crease bands relaxed, the eye bags down, the young midface's fat back
  if (spec.ageO && spec.ageGeo !== false && spec.youth > 0.001) { const a = spec.ageO, y = spec.youth, N = vnorm(P, tri, nb), M = creaseMask(P, I, nb), before = creaseRead(P, N, M, adj);
    // relaxed until the bands' crease depth is the gate's share of the person's own (at most `relax` passes): a 24-year-old keeps 0.45 of it
    let it = 0, now = before; while (it < a.relax && now != null && now > spec.gate * before) { laplaceRelax(P, N, M, adj, 1, 0.5); it++; now = creaseRead(P, N, M, adj); }
    const bag = a.bag * y; for (const s of ['l', 'r']) addTarget(F, P, `eyes/${s}-eye-bag-decr`, bag, k, n);
    // the fill: cheek volume and lift, by the measured per-unit moves (malar / buccal ~2.6 / 7.5 mm a unit of volume, lift 4.4 mm a unit)
    const fm = (a.fill?.[spec.sex] ?? 0) * y; let fillMm = 0;
    if (fm > 0) for (const s of ['l', 'r']) { fillMm = Math.max(fillMm, addTarget(F, P, `cheek/${s}-cheek-volume-incr`, 0.11 * fm, k, n)); addTarget(F, P, `cheek/${s}-cheek-trans-up`, 0.1 * fm, k, n); addTarget(F, P, `cheek/${s}-cheek-bones-incr`, 0.08 * fm, k, n); }
    const N2 = vnorm(P, tri, nb); R.age = { creaseUm: [before, creaseRead(P, N2, M, adj)], relax: it, bag: +bag.toFixed(3), fillMm: +(fillMm * 1000).toFixed(2) }; }
  // 3. the pleasant rest: the zygomaticus' tone (corner target over the stomion, capped), the cheeks lifted, a trace of the lower lid's raise
  if (spec.rest && spec.rest.kind !== 'neutral') { const o = spec.rest, kind = o.kind === 'smile' ? 'smile' : 'rest', tone = kind === 'smile' ? 1 : o.tone;
    const t0 = tiltOf(P, I), want = Math.min(o.cap[kind], t0 + o.corner[kind] * tone), cp = expr('mouth-corner-puller');
    let wz = 0; if (cp) { const dy = (0.5 * (cp[I.ch_L * 3 + 1] + cp[I.ch_R * 3 + 1]) - cp[I.sto * 3 + 1]) * 1000; wz = clamp((want - t0) / Math.max(1, dy), 0, kind === 'smile' ? 0.3 : 0.18); if (wz) for (let i = 0; i < nb * 3; i++) P[i] += wz * cp[i]; }
    const wc = o.cheek[kind] * tone; for (const s of ['l', 'r']) addTarget(F, P, `cheek/${s}-cheek-trans-up`, wc, k, n);
    const sl = o.slit[kind] * tone; for (const e of ['eye-left-slit', 'eye-right-slit']) { const A = expr(e); if (A && sl) for (let i = 0; i < nb * 3; i++) P[i] += sl * A[i]; }
    R.rest = { kind, tone: +tone.toFixed(3), zyg: +wz.toFixed(3), cheek: +wc.toFixed(3), slit: +sl.toFixed(3), tilt: [+t0.toFixed(2), +tiltOf(P, I).toFixed(2)] }; }
  R.tilt = +tiltOf(P, I).toFixed(2); R.asym = +asymOf(P, I).toFixed(2);
  return { P, report: R };
}

// ---------------------------------------------------------------- shading (after face3Skin / mouthSkin)
const F5_PARS = `uniform vec4 f5Lip; float f5LipG = 0.0;\n`;
// the vermilion's lines in the normal (likeG, lane B's micro-relief gradient, read at its normal slot), ~1.1 mm apart, 0.35 mm wide (so a
// line spans ~1-2 px at 1:1), wavering and fanning toward the corners, fading where they would alias; the wet band's sharp lobe
const F5_FRAG = `
{ vec3 b = vBind; float reg = vHero.x, fw = max(fwidth(b.x), 1e-7); if (b.y > hEyeL.y - 0.15 && reg > 1.5 && reg < 10.5) reg = 11.;
  if ((reg < 1.5 || reg > 10.5) && likeOn > 0.5 && abs(b.y - hMouth.y) < 0.03) {
    float inL, edgeL, wetL, rollL; likeLipGeo(b, inL, edgeL, wetL, rollL);
    if (inL > 0.001) { float ax = abs(b.x - likeLipK.w), u = ax / max(likeLipK.x, 1e-4);
      float sp = 0.00115, xs = (b.x - likeLipK.w) * (1.0 + 0.3 * u * u) + 0.00025 * sin(b.y * 1100.0 + b.x * 400.0), q = xs / sp - floor(xs / sp + 0.5), pd = q * sp, w1 = 0.00022;
      float amp = f5Lip.x * 0.00004 * (0.55 + 0.45 * vn3(vec3(floor(xs / sp + 0.5) * 1.3, b.y * 300.0, 5.0))) * smoothstep(0.9, 2.2, sp / fw) * (1.0 - 0.7 * edgeL) * smoothstep(1.0, 0.8, u);
      // the wet band (lane B's likeLipWet: just off the meeting line) more so on the lower lip: a smooth film over the lip's relief (the
      // relief and pores under it flattened, or the sharp lobe breaks into glitter), a sharper lobe and more of it
      float lower = step(b.y, hMouth.y), wb = clamp(wetL * inL * f5Lip.y * mix(0.45, 1.0, lower), 0.0, 1.0);
      likeG *= 1.0 - 0.75 * wb;
      likeG.x += inL * amp * 2.0 * pd / (w1 * w1) * exp(-pd * pd / (w1 * w1)) * (1.0 - 0.5 * wb); f5LipG = inL * amp;
      roughnessFactor = mix(roughnessFactor, 0.24, wb); likeOil = max(likeOil, 0.6 * wb); } } }
`;
export function face5Skin(h, f3) {
  const s = f3.f5?.spec, rep = { hook: false };
  if (!s) return rep;
  // the age gate on SKIN4's zones (rev-4 skin only) and lane B's lines
  const sk = h.likeness?.skin, u7 = f3.f7?.spec?.under || null;   // FACE7 (rev 8): per-zone gains on the gate, and the gate under skin rev 6 too
  // (under skin rev 6, which v6 runs ungated, only the zones FACE7 names with a gain < 1 change, by gain x the age gate; the rest stay v6's)
  if (s.ageO && sk) { const g = s.gate, zg = s.ageO.zoneFloor + (1 - s.ageO.zoneFloor) * (g - s.ageO.floor) / (1 - s.ageO.floor);
    if (s.ageO.lines && sk.U?.likeK2) { sk.U.likeK2.value.x *= g; rep.lines = +g.toFixed(3); }
    const geo = h.body.geometry, ZW = (sk.rev === 4 || (u7 && sk.rev === 6)) && sk.z4?.zones && geo.attributes.aLikeB && h.aHero ? zoneWeights(geo.attributes.position.array, geo.attributes.position.count, h.aHero, s.ageO.zones) : null;
    if (ZW) {
      const B = geo.attributes.aLikeB, C = geo.attributes.aLikeC, n = B.count, dm = new Float32Array(n), db = new Float32Array(n), dp = new Float32Array(n);
      for (const [name, W] of Object.entries(ZW.w)) { const z = sk.z4.zones[name]; if (!z) continue; const zz = !u7 ? zg : sk.rev === 6 ? (u7[name] == null || u7[name] >= 1 ? 1 : zg * u7[name]) : zg * (u7[name] ?? 1), lm = Math.log(z[0]) * (zz - 1), lb = Math.log(z[1]) * (zz - 1);
        if (u7) { for (let v = 0; v < Math.min(n, W.length); v++) if (W[v]) { dm[v] += W[v] * lm; db[v] += W[v] * lb; dp[v] = Math.max(dp[v], W[v] * (1 - zz)); } continue; }
        for (let v = 0; v < Math.min(n, W.length); v++) if (W[v]) { dm[v] += W[v] * lm; db[v] += W[v] * lb; dp[v] = Math.max(dp[v], W[v]); } }
      // the face's mean back to the preset (as fields4 does): over the front of the face
      let sm = 0, sb = 0, c = 0; for (const v of ZW.front) { if (v >= n) continue; sm += dm[v]; sb += db[v]; c++; } const km = c ? sm / c : 0, kb = c ? sb / c : 0;
      for (let v = 0; v < Math.min(n, ZW.region.length); v++) { if (!ZW.region[v]) continue; B.array[v * 4] *= Math.exp(dm[v] - km); B.array[v * 4 + 1] *= Math.exp(db[v] - kb); if (C) C.array[v * 4] *= u7 ? 1 - dp[v] : 1 - (1 - zg) * dp[v]; }
      B.needsUpdate = true; if (C) C.needsUpdate = true; rep.zones = { gain: +zg.toFixed(3), norm: [+Math.exp(-km).toFixed(3), +Math.exp(-kb).toFixed(3)], ...(u7 ? { f7: u7 } : {}) }; } }
  // lips: the border softer (live uniforms: lane B's lip line and MOUTH's), the lines in the normal, the wet band
  if (s.lips) { const lu = sk?.lipLine?.U?.likeLipK; if (lu) { lu.value.z = Math.max(lu.value.z, s.lips.soft); rep.soft = s.lips.soft; }
    const mu = h.mouth5?.U?.moLipK; if (mu) mu.value[2] = Math.max(mu.value[2], s.lips.soft);
    // the hook needs lane B's lip variables (rev-1 or rev-4 skin with MOUTH's lip line, '-lipg1'); otherwise it is skipped
    const hooks = [].concat(h.o.skinHook || []), hasLipG = hooks.some(x => /-lipg1$/.test(x?.key || ''));
    if (hasLipG && typeof h.useSkinHook === 'function') { h.useSkinHook({ key: 'face5', uniforms: { f5Lip: { value: new Float32Array([s.lips.fissure, s.lips.wet, 0, 0]) } }, fragPars: F5_PARS, frag: F5_FRAG }); rep.hook = true; } }
  h.face5 = { spec: s, report: rep };
  return rep;
}

// ---------------------------------------------------------------- for Cycles (LIGHT5 owns the fix; a hand-off, nothing calls this yet)
// lidMask(F, P, nb, { mm }) -> Float32Array(nb): 1 on the lid margins (FACE c2's landmarks.json lidMargin rings), falling to 0 by `mm`
// (default 3) along the skin: the thin skin a random-walk subsurface lights through (judge c10: the raised lower lid glows orange under
// the studio key in Cycles). person_scene.py can scale the subsurface radius by (1 - 0.8 x mask) there, or the export can carry it as
// a vertex colour. Bind positions, metres.
export function lidMask(F, P, nb, { mm = 3 } = {}) {
  const M = new Float32Array(nb), ring = [...(F.lid?.L || []), ...(F.lid?.R || [])].filter(v => v < nb), s = mm / 1000;
  if (!ring.length) return M;
  for (let v = 0; v < nb; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; let d = Infinity;
    for (const r of ring) { const dx = x - P[r * 3], dy = y - P[r * 3 + 1], dz = z - P[r * 3 + 2], e = dx * dx + dy * dy + dz * dz; if (e < d) d = e; }
    if (d < 4 * s * s) M[v] = Math.exp(-0.5 * d / (0.5 * s) ** 2); }
  return M;
}
