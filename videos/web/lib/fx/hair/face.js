// HAIR / face: brows, lashes and beards as cards on the person's own face (HUMAN c8 lane D).
//
// Brows. The line follows the person's eyes (field.js): the head starts a few mm medial of the inner canthus, the tail ends ~1 cm past
// the outer canthus, the arch peaks over the lateral limbus. Women's and men's brows are their own shapes, not one shape scaled:
// on average men's sit lower on the orbital rim, flatter and thicker; women's higher, more arched, finer at the tail (Farkas,
// Anthropometry of the head and face, 1994, and Farkas et al. 2005's orbital measures for the eye frame; the brow-shape differences
// are the standard ones of brow surgery and anthropometry, e.g. the brow at or below the rim in men, above it in women). They vary
// per person (seeded: thickness, arch, tail, density). Hairs grow the way brows do: at the head they point up, along the body the
// upper rows point out and down and the lower rows out and up (a herringbone that converges on the brow's mid-line), at the tail
// out and down; 5-10 mm long, lying close to the skin. Each card carries ~6 hairs from the atlas's brow tile.
// Lashes. Rooted on the lid margins found by field.js (where the lid starts to cover the globe); upper ~120-150 lashes in two
// staggered rows, 7-11 mm, longest at the middle and outer third, leaving forward and curving up; lower ~60, 5-7 mm, forward and
// down (Thibaut, De Becker, Caisey et al. 2010, "Human eyelash characterization", Br J Dermatol 162:304: upper 90-160 lashes, lower
// 75-80). The same for women and men; no mascara, no lengthening: that is a style choice, not a default.
// Beards. A zone in bind space (the cheek line from the sideburn to the mouth corner, the neckline under the jaw, the moustache over
// the lip, the lips themselves clear), and three treatments over a darkened base (the stubble on the skin, shade.js): stubble only
// (follicle dashes and the blue-grey of shafts under the skin), short (6-12 mm cards lying along the jaw), full (2-6 cm, longest at
// the chin, with volume and the moustache over the lip). Cards are skinned with the jaw's and the lips' own weights and carry the
// expression morph deltas, so they open with the mouth.
import * as THREE from 'three';
import { REG, sstep, mulberry } from './field.js';
import { V, clamp, growStrand, curlPts, skinBlend } from './grow.js';

// cells of the head, jaw and neck facing the front (for the beard), cached
function faceCells(F) {
  if (F._fcells) return F._fcells;
  const { N, R, TRI, C } = F, d = [0, 0, 0], list = [], AH = F.h.aHero, IDX = F.h.body.geometry.index.array;
  for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ci = (f * N + j) * N + i, t = TRI[ci]; if (t < 0) continue;
    const rg = AH[IDX[t] * 4]; if (rg !== REG.head && rg !== REG.jaw && rg !== REG.neck) continue;
    const u = (i + 0.5) / N * 2 - 1, v = (j + 0.5) / N * 2 - 1; F.faceDir(f, u, v, d);
    const r = R[ci], y = C.y + d[1] * r; if (y > F.eyeY + 0.01 || y < F.chinY - 0.09) continue;
    const sp = F.surf(t, F.BB[ci * 2], F.BB[ci * 2 + 1]), cosA = Math.max(0.25, Math.abs(sp.n.x * d[0] + sp.n.y * d[1] + sp.n.z * d[2]));
    list.push({ ci, f, u, v, p: sp.p, n: sp.n, area: (2 / N) * (2 / N) / Math.pow(1 + u * u + v * v, 1.5) * r * r / cosA, ph: Math.atan2(sp.p.x - C.x, sp.p.z - C.z) });
  }
  return (F._fcells = list);
}
function sampleCells(F, cells, dens, count, rnd, minSep) {
  const w = cells.map(c => c.area * dens(c.p, c.n)), tot = w.reduce((a, b) => a + b, 0); if (tot <= 0) return [];
  const area = cells.reduce((a, c, k) => a + c.area * Math.min(1, w[k] / Math.max(c.area, 1e-12)), 0), sep = minSep ?? 0.6 * Math.sqrt(area / count);
  const cdf = []; let acc = 0; for (const x of w) { acc += x; cdf.push(acc / tot); }
  const out = [], grid = new Map(), dd = [0, 0, 0], cell = sep;
  for (let it = 0; it < count * 4 && out.length < count; it++) {
    const q = rnd(); let lo = 0, hi = cdf.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < q) lo = m + 1; else hi = m; }
    const c = cells[lo]; F.faceDir(c.f, c.u + (rnd() - 0.5) * 2 / F.N, c.v + (rnd() - 0.5) * 2 / F.N, dd);
    const hit = F.cast(dd[0], dd[1], dd[2]); if (!hit) continue; const sp = F.surf(hit.tri, hit.b1, hit.b2);
    if (dens(sp.p, sp.n) < rnd() * 0.999) continue;
    const k0 = Math.floor(sp.p.x / cell), k1 = Math.floor(sp.p.y / cell), k2 = Math.floor(sp.p.z / cell); let ok = true;
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (let e = -1; e <= 1 && ok; e++) { const L = grid.get(`${k0 + a},${k1 + b},${k2 + e}`); if (L) for (const o of L) if (o.p.distanceToSquared(sp.p) < sep * sep) { ok = false; break; } }
    if (!ok) continue; const kk = `${k0},${k1},${k2}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(sp); out.push(sp);
  }
  return out;
}

// ---------------------------------------------------------------- the beard zone (0..1 density) in bind space
// B: { cheek (cm, the cheek line's height at the sideburn: lower = a cleaner cheek), neck (cm below the chin the neckline sits),
// moustache (0..1), chin (0..1), soft (cm) }
export function beardZone(F, B = {}) {
  const eyeY = F.eyeY, mY = F.mouth.y, mZ = F.mouth.z, hc = F.hc, front = F.eL.z, soft = (B.soft ?? 0.35) / 100;
  const cheekHi = (B.cheek ?? -2.4) / 100, neckD = (B.neck ?? 3.0) / 100, must = B.moustache ?? 1, chinK = B.chin ?? 1, sideK = B.sides ?? 1;
  return p => {
    const ax = Math.abs(p.x), ys = p.y - eyeY, fz = (p.z - hc.z) / (front - hc.z), ph = Math.abs(Math.atan2(p.x - F.C.x, p.z - F.C.z));
    if (ph > F.earF - 0.05 || fz < -0.1) return 0;                                          // in front of the ear
    // the cheek line: high at the sideburn, down to just above the mouth corner
    const cl = (mY - eyeY + 0.015) + (cheekHi - (mY - eyeY + 0.015)) * sstep(0.028, 0.068, ax);
    let d = sstep(cl + soft, cl - soft, ys);
    // the neckline: under the chin, rising toward the jaw angle
    const nl = (F.chinY - neckD) + 0.03 * sstep(0.2, -0.3, fz);
    d *= sstep(nl - soft, nl + soft, p.y);
    // the lips stay clear; the moustache is the band between the nose and the upper lip
    const lx = p.x / 0.027, ly = (p.y - mY) / 0.0095; if (lx * lx + ly * ly < 1 && p.z > mZ - 0.025) d = 0;
    const inM = ys > mY - eyeY + 0.004 && ys < mY - eyeY + 0.02 && ax < 0.03 && p.z > mZ - 0.03;
    if (inM) d *= must; else if (ax < 0.03 && p.y < mY && p.y > F.chinY - 0.03 && p.z > mZ - 0.04) d *= chinK; else d *= sideK;
    return d;
  };
}
// the beard's comb: down the cheek and jaw, out and down over the lip, toward the neck under the chin
function beardFlow(F) {
  const mY = F.mouth.y;
  return (p, n) => {
    const ax = Math.abs(p.x), s = Math.sign(p.x) || 1; let v;
    if (p.y > mY + 0.003 && ax < 0.03 && p.z > F.mouth.z - 0.03) v = V(s * 0.55, -1, 0.15);   // moustache
    else if (n.y < -0.35) v = V(0, -1, -0.3);                                                    // under the jaw: down, a little back
    else v = V(-s * 0.08, -1, 0.25);
    const r = v.addScaledVector(n, -v.dot(n)); return r.lengthSq() > 1e-8 ? r.normalize() : V(0, -1, 0);
  };
}

// ---------------------------------------------------------------- brows
// returns { centre(u, side) -> {x, y}, thick(u), dir(u, v, side) }; o: { sex, seed, thick, arch, lift (cm), tail }
export function browShape(F, o = {}) {
  const rnd = mulberry((o.seed ?? 1) * 53 + 9), fem = (o.sex ?? F.sex) === 'f', L = F.lids.L, R0 = L.R;
  const inC = L.upper.length ? Math.abs(L.upper[0].x) : Math.abs(F.eL.x) - 0.011, outC = L.upper.length ? Math.abs(L.upper.at(-1).x) : Math.abs(F.eL.x) + 0.011;
  const xh = inC - 0.004 - 0.002 * rnd(), xt = outC + 0.010 + 0.004 * rnd() + (o.tail ?? 0) / 100;
  const base = (fem ? 0.0215 : 0.0185) + (o.lift ?? 0) / 100 + 0.002 * (rnd() - 0.5), arch = (fem ? 0.0062 : 0.0032) * (o.arch ?? 1) * (0.8 + 0.4 * rnd());
  const th0 = (fem ? 0.0062 : 0.0092) * (o.thick ?? 1) * (0.85 + 0.3 * rnd()), th1 = (fem ? 0.0018 : 0.0032) * (o.thick ?? 1);
  const peak = fem ? 0.66 : 0.58;
  const archAt = u => arch * Math.sin(Math.min(1, u / peak) * Math.PI / 2) * (u > peak ? 1 - 1.6 * Math.pow((u - peak) / (1 - peak), 2) * 0.6 : 1) - 0.002 * u * u;
  const thick = u => th0 + (th1 - th0) * Math.pow(u, 1.25) * (u > 0.85 ? 1 + 0.6 * (u - 0.85) / 0.15 : 1);
  // (FACE7 c5 it 12; o.rim = { k }) THE BROW ON ITS BONE: the brow's height from the supraorbital margin under this person's skin, not a
  // constant over the eye nor the photographs' percentile (face7Hair's `cal` lift, retired under rim). The brow's hairs grow from the skin
  // over the margin: in men the brow lies ON the margin, in women its lower edge on it and the body above (Westmore; Ellenbogen 1983;
  // the oculoplastic texts, as recalled: said so). k: where the margin falls across the brow at the pupil's column, in half-thicknesses
  // below the brow's centre (0: the centre on the margin, 1: the lower edge). The margin: o.rim.dy (m over the eyes' centre: the SKULL's
  // supraorbital margin, which face7Hair draws from ANAT8-HEAD's skull tables for this person: half the orbit's height over the orbit's
  // centre, the orbit's centre 1.5 mm under the globe's, skull.js' seating); without it, browRim on the skin (an instrument: on a flat
  // brow, L20, the skin carries no ridge and it reads the margin ~6 mm low).
  const rim = o.rim ? (o.rim.dy != null ? { dy: o.rim.dy, how: 'skull', sulcus: NaN } : F.cast ? browRim(F, Math.abs(F.eL.x)) : null) : null;
  let base0 = base;
  if (rim) { const up = (Math.abs(F.eL.x) - xh) / Math.max(1e-6, xt - xh); base0 = rim.dy + (o.rim.k ?? 0) * thick(up) / 2 - archAt(up); }
  const centre = u => ({ x: xh + (xt - xh) * u, y: F.eyeY + base0 + archAt(u) });
  return { centre, thick, xh, xt, fem, R0, rim: rim ? { dyMm: +(rim.dy * 1000).toFixed(2), how: rim.how, liftMm: +((base0 - base) * 1000).toFixed(2) } : null };
}
// browRim(F, x) -> { dy (m over the eyes' centre), how }: the supraorbital margin on the skin at the column x (the pupil's). In the column's
// sagittal profile the skin dips into the sulcus over the upper lid (the lowest point 4-12 mm over the eyes' centre), rises steeply over
// the margin and turns onto the brow's front; the margin's skin is the brow ridge's most forward point within 12 mm over the sulcus (the
// forehead above it is the frontal bone's face, not the margin: a sloping brow's forehead can stand further forward than its margin)
export function browRim(F, x) {
  const prof = [], zf = F.eL.z + 0.012 - F.C.z;
  for (let dy = 0.004; dy <= 0.030 + 1e-9; dy += 0.0005) { const y = F.eyeY + dy, d = [x - F.C.x, y - F.C.y, zf], r = F.cast(d[0], d[1], d[2]); if (!r) continue;
    const l = Math.hypot(d[0], d[1], d[2]); prof.push({ dy: F.C.y + d[1] / l * r.r - F.eyeY, z: F.C.z + zf / l * r.r }); }
  let s = null; for (const p of prof) if (p.dy <= 0.012 && (!s || p.z < s.z)) s = p; if (!s) return null;
  let best = null; for (const p of prof) if (p.dy > s.dy && p.dy <= s.dy + 0.012 && (!best || p.z > best.z)) best = p;
  return best ? { dy: best.dy, how: 'ridge', sulcus: s.dy } : null;
}
// FACE7 (c3 it 7, 8 Oct): THE BROW AS A FOLLICLE FIELD (o.fol; FACE7 passes it under face rev 8). The card brows above read as a painted
// band: 225-285 cards a side, each 1.3-1.7 mm wide carrying ~3 of the atlas tile's hairs, uniformly inside a hard-edged band over a dark
// soft base, so the cover was near total and the edges crisp. A real brow is single hairs (they emerge one by one, not in the scalp's 1-4
// hair follicular units: the reason brow restoration uses single-hair grafts), a few hundred a side, about 1 mm apart, with skin seen between
// them; they leave the skin at a very acute angle and lie nearly flat; at the head they point up, along the body the upper hairs out and down
// and the lower out and up, converging into a soft ridge along the brow's middle; the tail feathers out and down and is the sparsest and
// finest part (Suchonwanit & Thammarucha 2019, J Cosmet Dermatol: density and diameter lowest in the tail); the edges fade rather than stop.
// Here: follicles drawn as blue noise over the skin (at least `sep` mm apart) with a density field rho(u, v) in hairs per cm2 of skin
// (u along the line, v across in half-thicknesses of browShape's band): full in the core, falling off over `lower` / `upper` half-
// thicknesses past it (the upper edge softer), a few strays out to `out`, `head` and `tail` shares at the ends, the tail thinning with age in
// women; one hair per follicle: a card `w` mm wide (root / tip; the atlas tile's strands squeezed into it, so it draws as one hair, and
// person_hair.py spreads its two strands within it), its length by region, leaving the skin at `exit` degrees and arcing back toward it
// (`lie` mm off the skin at the tip per 8 mm), following the skin's curvature, its direction by region with a slight curl.
function growBrowsFol(F, S, o, fo) {
  const rnd = mulberry((o.seed ?? 1) * 101 + 3), age = o.age ?? 30, cards = [], C = F.C, zP = F.eL.z + 0.012;
  const rho0 = (fo.rho ?? 90) * (0.88 + 0.24 * rnd()), sep0 = (fo.sep ?? 0.42) / 1000, exitT = Math.tan((fo.exit ?? 16) * Math.PI / 180), lie = fo.lie ?? 0.55;
  const [lH, lB, lT] = fo.len ?? [5, 7.5, 5], core = fo.core ?? 0.55, out = fo.out ?? 1.9;
  // (FACE7 c5 it 11; plate tag br13) a card draws `clump` hairs at their calibre `cal` (mm), not one squeezed hair: the engine's card takes half the atlas'
  // brow tile (index.js: ua = 0.45 rand, ub = ua + 0.5). Measured on the atlas in node (labs/human8/_scratch_face7/browtile.mjs: the
  // coverage channel over the tile's middle rows): 6-9 strands across the tile, ~3.5 px each, a half-tile window covered 0.12-0.25 (mean
  // ~0.21) = ~4 strands of 3.5 / 64 = STRAND of the card's width. Squeezed into a 0.3 mm card each strand drew ~0.016 mm (a fifth of a
  // real brow hair): 140 hairs / cm2 x 7 mm x 0.016 mm covered ~15 % of the skin where a brow's hairs cover ~50-70 % (x 0.075 mm), so
  // the brows vanished in the engine.
  // Here the card is as wide as its strands need to be to draw at the hair's calibre (cal / STRAND), and the follicle field places cards
  // at rho / clump, so the HAIR count per cm2 (rho) and the summed projected width (the brow's coverage) are the anatomy's. Brows lie in
  // overlapping rows of neighbouring hairs running the same way, so a card of a few neighbours along one direction is the field, binned.
  // Without cal: the it 7 single-hair cards (w mm), as before.
  const STRAND = 0.055, cl = fo.cal ? Math.max(1, fo.clump ?? 4) : 1;
  const [w0m, w1m] = fo.cal ? [fo.cal / STRAND, fo.cal / STRAND * (fo.conv ?? 0.75)] : (fo.w ?? [0.3, 0.12]);
  const thick = u => Math.max(0.0012, S.thick(u));   // (browShape's width overshoots below 0 at the very tail of a thick head: the tail's few hairs keep 1.2 mm)
  const dens = (u, v) => {
    let A = (fo.head ?? 0.5) + (1 - (fo.head ?? 0.5)) * sstep(0, 0.2, u);
    A *= 1 - (1 - (fo.tail ?? 0.4)) * sstep(0.6, 1, u);
    if (S.fem) A *= 1 - 0.35 * sstep(40, 70, age) * sstep(0.5, 1, u);                      // (the tail thins with age in women)
    A *= sstep(-0.06, 0, u) * (1 - sstep(1, 1.06, u));
    const E = v < 0 ? 1 - sstep(core, core + (fo.lower ?? 0.55), -v) : 1 - sstep(core, core + (fo.upper ?? 0.85), v);
    return A * Math.max(E, (fo.stray ?? 0.05) * (1 - sstep(1, out, Math.abs(v))));
  };
  const sep = sep0 * Math.sqrt(cl), rhoC = rho0 / cl;   // (cards, not hairs: the spacing and density of the binned field)
  // the band's bounds in the face plane (x along the side's magnitude, y)
  let yLo = Infinity, yHi = -Infinity; for (let k = 0; k <= 20; k++) { const u = k / 20, c = S.centre(u), h = thick(u) / 2 * out; yLo = Math.min(yLo, c.y - h); yHi = Math.max(yHi, c.y + h); }
  const x0 = S.xh - 0.003, x1 = S.xt + 0.003, Arect = (x1 - x0) * (yHi - yLo) * 1e4, K = Math.ceil(Arect * rhoC * 2.5);
  const report = { rho0: +rho0.toFixed(1), cand: K, clump: cl, wMm: [+w0m.toFixed(3), +w1m.toFixed(3)], sides: {} };
  for (const side of [1, -1]) {
    const grid = new Map(), cell = sep, near = p => { const k0 = Math.floor(p.x / cell), k1 = Math.floor(p.y / cell), k2 = Math.floor(p.z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) { const L = grid.get(`${k0 + a},${k1 + b},${k2 + e}`); if (L) for (const q of L) if (q.distanceToSquared(p) < sep * sep) return true; } return false; };
    const put = p => { const kk = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(p); };
    // (FACE7 c5 it 13) the follicles keep their least distance (sep) by dart throwing, and a dart that lands too near a placed one is
    // thrown again: until it 12 it was dropped, so the field held ~30 % fewer follicles than rho says (L08: 44 cards a side where the same
    // field without the spacing holds 63). `owed` counts those drops; the throwing goes on past K until they are placed (at most 4 K).
    // (fo.dart 'drop': the it 12 sampler, for the A/B only)
    let n = 0, area = 0, owed = 0; const rethrow = fo.dart !== 'drop';
    for (let it = 0; it < K || (rethrow && owed > 0 && it < 4 * K); it++) {
      const xm = x0 + (x1 - x0) * rnd(), y = yLo + (yHi - yLo) * rnd(), u = (xm - S.xh) / (S.xt - S.xh), uc = Math.min(1, Math.max(0, u)), c = S.centre(uc), th = thick(uc);
      const v = (y - c.y) / (th / 2), dn = dens(u, v); if (dn <= 0) continue;
      const x = side * xm, hit = F.cast(x - C.x, y - C.y, zP - C.z); if (!hit) continue; const sp = F.surf(hit.tri, hit.b1, hit.b2);
      const rd = V(x - C.x, y - C.y, zP - C.z).normalize(), cosA = Math.max(0.4, Math.abs(rd.dot(sp.n)));
      if (rnd() * 2.5 > dn / cosA) continue;                                                      // (per cm2 of skin, not of the face plane)
      if (near(sp.p)) { if (it < K) owed++; continue; } put(sp.p.clone()); n++; if (it >= K) owed--;
      // the hair's direction in the face plane: up at the head, the herringbone along the body (the rows converging on the mid-line), out
      // and down at the tail
      const headA = 1.35 - 2.5 * Math.min(0.2, uc) + 0.12 * (rnd() - 0.5), bodyA = -0.55 * Math.max(-1.3, Math.min(1.3, v)) * (1 - 0.45 * uc) + 0.06 + 0.1 * (rnd() - 0.5), tailA = -0.35 + 0.1 * (rnd() - 0.5);
      let ang = headA + (bodyA - headA) * sstep(0.1, 0.28, uc); ang += (tailA - ang) * sstep(0.72, 0.95, uc);
      const d2 = V(side * Math.cos(ang), Math.sin(ang), 0.2), tdir = d2.addScaledVector(sp.n, -d2.dot(sp.n)).normalize(), bn = sp.n.clone().cross(tdir).normalize();
      let len = (lH + (lB - lH) * sstep(0.05, 0.3, uc)); len += (lT - len) * sstep(0.75, 1, uc); len *= (0.8 + 0.4 * rnd()) * (Math.abs(v) > 1 ? 0.8 : 1) * (o.len ?? 1);
      if (age > 55 && !S.fem && rnd() < 0.12) len *= 1.8;                                        // (the older man's long coarse hairs)
      const L = len / 1000, a = L * exitT, b = a - lie / 1000 * len / 8, curl = 0.3 * (rnd() - 0.5), pts = [];
      for (let s = 0; s <= 4; s++) { const t = s / 4, ca = Math.cos(curl * t), sa = Math.sin(curl * t), dir = tdir.clone().multiplyScalar(ca).addScaledVector(bn, sa);
        const q = sp.p.clone().addScaledVector(dir, L * t), r = F.cast(q.x - C.x, q.y - C.y, q.z - C.z), hgt = 0.00005 + a * t - b * t * t;
        if (r) { const radial = q.clone().sub(C).normalize(); q.copy(C).addScaledVector(radial, r.r + hgt); } else q.addScaledVector(sp.n, hgt);
        pts.push(q); }
      const wk = 1 - 0.2 * sstep(0.6, 1, uc);                                                     // (the tail's hairs finest)
      cards.push({ sp, pts, w0: w0m / 1000 * wk, w1: w1m / 1000 * wk, rand: rnd(), u: uc, depth: 0.15 * rnd(), fol: 1 });
    }
    report.sides[side > 0 ? 'L' : 'R'] = n;
  }
  return { cards, shape: S, fol: report };
}
export function growBrows(F, B, o = {}) {
  if (o.fol) return growBrowsFol(F, browShape(F, o), o, o.fol);
  const S = browShape(F, o), rnd = mulberry((o.seed ?? 1) * 101 + 3), n = Math.round((S.fem ? 150 : 190) * (o.density ?? 1)), cards = [];
  const age = o.age ?? 30;
  for (const side of [1, -1]) {
    for (let k = 0; k < n; k++) {
      // denser in the body than at the head and tail
      let u = rnd(); u = u < 0.12 ? u * 0.9 : u; const w = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.15));
      if (rnd() > w) { k--; continue; }
      const v = (rnd() * 2 - 1) * (u < 0.1 ? 0.9 : 1), c = S.centre(u), th = S.thick(u), x = side * c.x, y = c.y + v * th / 2 * (u < 0.1 ? 1.15 : 1);
      const dir = F.cast(x - F.C.x, y - F.C.y, F.eL.z + 0.012 - F.C.z); if (!dir) continue;
      const sp = F.surf(dir.tri, dir.b1, dir.b2);
      // hair direction in the face plane: up at the head, herringbone in the body, out and down at the tail
      // (the herringbone kept gentle: the rows converge on the mid-line at ~10-14 deg, not crossing at 40; crossing strokes read as a scribble)
      const ang = u < 0.14 ? 1.2 - 4.5 * u : u > 0.85 ? -0.3 : (v > 0 ? -0.2 : 0.24) + 0.08 * (rnd() - 0.5) - 0.12 * Math.max(0, u - 0.6);
      const d2 = V(side * Math.cos(ang), Math.sin(ang), 0.35);
      const dd = d2.addScaledVector(sp.n, -d2.dot(sp.n)).normalize().multiplyScalar(0.98).addScaledVector(sp.n, 0.07).normalize();
      const len = (u < 0.14 ? 0.0058 : u > 0.85 ? 0.0055 : 0.0085) * (0.8 + 0.4 * rnd()) * (o.len ?? 1) * (age > 55 && !S.fem && rnd() < 0.12 ? 1.8 : 1);
      const pts = []; const p = sp.p.clone().addScaledVector(sp.n, 0.0004);
      for (let s = 0; s <= 3; s++) { const t = s / 3, q = p.clone().addScaledVector(dd, len * t); const r = F.cast(q.x - F.C.x, q.y - F.C.y, q.z - F.C.z); if (r) { const sk = F.C.clone().add(q.clone().sub(F.C).normalize().multiplyScalar(r.r)); const out = q.distanceTo(F.C) - r.r; if (out < 0.0004 + 0.0007 * t) q.copy(sk).addScaledVector(q.clone().sub(F.C).normalize(), 0.0004 + 0.0007 * t); } pts.push(q); }
      cards.push({ sp, pts, w0: 0.0013 + 0.0004 * rnd(), w1: 0.0009, rand: rnd(), u, depth: rnd() * 0.5 });
    }
  }
  return { cards, shape: S };
}

// ---------------------------------------------------------------- lashes
// FACE7 it 5 (opt-in: o.eye7 = face7's drawn globes, { L, R: { c: [x, y, z] bind m, the inset applied, R, rl, rc } }): the lid margins found
// against the eye the renderers DRAW (eyes.js: the corneal cap rc in front of the limbus rl, the globe R behind it) instead of field.js'
// sphere (the eye proxy's mean centre and radius, 3.3-4 mm in front of the drawn globe's centre on L06 / L08): there the upper lashes
// rooted ~4.5 mm over the lid's real edge and the lid's skin between read as a pale band over the iris. The same raster and margin rule as
// field.js lidMargins (the first skin row outside the open span, with its triangle, so the lashes carry the lid's skin weights and morphs).
export function lidMargins7(h, eye7) {
  const g = h.body.geometry, P = g.attributes.position.array, IDX = g.index.array, AH = h.aHero, out = {};
  for (const side of ['L', 'R']) { const e = eye7[side]; if (!e) continue;
    const c = V(e.c[0], e.c[1], e.c[2]), R = e.R, rl = e.rl ?? 0.006, rc = e.rc ?? 0.0078, thL = Math.asin(Math.min(0.99, rl / R)), zcc = R * Math.cos(thL) - Math.sqrt(rc * rc - rl * rl);
    const zEye = rho2 => rho2 < rl * rl ? zcc + Math.sqrt(rc * rc - rho2) : Math.sqrt(Math.max(0, R * R - rho2));
    const res = 0.0002, W = 0.036, Hh = 0.03, nx = Math.round(W / res), ny = Math.round(Hh / res), x0 = c.x - W / 2, y0 = c.y - Hh / 2;
    const ZS = new Float32Array(nx * ny).fill(-1e9), TS = new Int32Array(nx * ny).fill(-1), B1 = new Float32Array(nx * ny), B2 = new Float32Array(nx * ny);
    for (let t = 0; t < IDX.length; t += 3) { const a = IDX[t], b = IDX[t + 1], cc = IDX[t + 2];
      if (AH[a * 4] !== REG.head) continue;
      const ax = P[a * 3], ay = P[a * 3 + 1], bx = P[b * 3], by = P[b * 3 + 1], cx = P[cc * 3], cy = P[cc * 3 + 1];
      const mnx = Math.min(ax, bx, cx), mxx = Math.max(ax, bx, cx), mny = Math.min(ay, by, cy), mxy = Math.max(ay, by, cy);
      if (mxx < x0 || mnx > x0 + W || mxy < y0 || mny > y0 + Hh) continue;
      const az = P[a * 3 + 2], bz = P[b * 3 + 2], cz = P[cc * 3 + 2]; if (Math.max(az, bz, cz) < c.z - 0.004) continue;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-14) continue;
      const i0 = Math.max(0, Math.floor((mnx - x0) / res)), i1 = Math.min(nx - 1, Math.ceil((mxx - x0) / res)), j0 = Math.max(0, Math.floor((mny - y0) / res)), j1 = Math.min(ny - 1, Math.ceil((mxy - y0) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) * res, y = y0 + (j + 0.5) * res;
        const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue; const z = w0 * az + w1 * bz + w2 * cz, k = j * nx + i;
        if (z > ZS[k]) { ZS[k] = z; TS[k] = t; B1[k] = w1; B2[k] = w2; } } }
    const up = [], lo = [];
    for (let i = 0; i < nx; i++) { const x = x0 + (i + 0.5) * res, dx = x - c.x; if (Math.abs(dx) > R) continue; let jt = -1, jb = -1;
      // the open span through the eye's centre row (connected to it): a skin fold elsewhere does not split it
      for (let j = 0; j < ny; j++) { const y = y0 + (j + 0.5) * res, rho2 = dx * dx + (y - c.y) * (y - c.y); if (rho2 > R * R) continue; const zb = c.z + zEye(rho2), k = j * nx + i;
        if (zb > ZS[k] + 0.00015) { if (jb < 0) jb = j; jt = j; } }
      if (jt < 0 || jt - jb < 3) continue;
      const pick = j => { const k = j * nx + i; return TS[k] >= 0 ? { x, y: y0 + (j + 0.5) * res, z: ZS[k], tri: TS[k], b1: B1[k], b2: B2[k] } : null; };
      // (FACE7 it 8: e.ant / e.antLo, mm) a lid with a margin of real thickness (face7 lidTissue): the lashes root on its ANTERIOR edge,
      // the first skin over the open span (or under it) standing that far in front of the eye, within 1.6 mm of the span
      const ant = (j0, dir, a) => { if (!a) return j0; for (let q = 0; q <= 8; q++) { const j = j0 + dir * q; if (j < 0 || j >= ny) break; const k = j * nx + i, y = y0 + (j + 0.5) * res, rho2 = dx * dx + (y - c.y) * (y - c.y);
        if (rho2 > R * R || TS[k] < 0) break; if (ZS[k] - (c.z + zEye(rho2)) >= a / 1000) return j; } return j0; };
      const a = pick(ant(Math.min(ny - 1, jt + 1), 1, e.ant)), b = pick(ant(Math.max(0, jb - 1), -1, e.antLo)); if (a) up.push(a); if (b) lo.push(b); }
    const order = arr => arr.sort((p, q) => Math.abs(p.x) - Math.abs(q.x));
    out[side] = { c, R, upper: order(up), lower: order(lo), eye7: true };
  }
  return out;
}
// FACE7 c4 it 10 (o.fol with o.eye7; the A/B under measurement: face7 { lashes: { fol: {} } }): the lash ROWS grown from their follicles
// along the lid margins, as the anatomy has them, instead of 36 + 10 cards leaving forward and curling up from the root (whose fringe,
// seen from the front, was a 4-5 mm tall half-tone of ~45 % cover over the lit pretarsal lid: the 'pale grey fringe'; and no lower row at
// all since FACE5 took it out). What a lash row is (Thibaut, De Becker, Caisey et al. 2010, Br J Dermatol 162:304, and the oculoplastic
// texts, as recalled; said so): upper ~90-160 lashes in 2-3 irregular rows on the margin's anterior edge, none medial of the lacrimal
// punctum, 8-12 mm (shortest medially, longest in the middle third), ~0.1 mm at the root and tapering to a point; the proximal shaft
// leaves the margin forward and a little DOWN and runs straight, the curve (the lift) is in the distal half; neighbouring lashes gather
// in clumps of 3-5 toward their tips; lower ~60-80, finer, 4-7 mm, forward and down. East Asian lashes are on average fewer, thicker,
// shorter and straighter (a lower lift, the base more downward); African lashes the most curled. With age the rows thin, shorten and
// lose calibre. So, per lid (medial -> lateral over the margin's lashed span):
//   upper  cards of FOUR lashes (the atlas' lash tile draws four strands converging toward the tip: one clump), the card's root width set
//          so each strand is the lash's calibre (the tile's strand is ~1/16 of its width), the tip `tip` x the root (the clump gathers);
//          alternate cards in a second row 0.3 mm higher on the margin, 0.15 mm behind and shorter; the path: straight for `straight` of the length
//          at `base` deg (below the eye's forward axis; the lateral ones fanning out), then the curl, turning fastest first, to `lift` deg at the tip;
//   lower  single lashes (a slice of the tile with one strand), `base` -> `tip` deg (down and out), no medial lashes over `bare`.
// Every number is a group mean with the person's seeded spread; nothing here is fitted to a render or a photograph.
const LASH_SLICE = [0.40, 0.60];
// (FACE7 c7 it 18) what a lash card IS, for the shaders that draw its hairs (hair/brow7.js lashStrands7; Cycles: person_hair.py LASH7 through
// the material's shade.lash7): n lashes a card and the share of the card's ROOT width one lash is (its calibre: growLashesFol below sets the
// upper card's root width to 16 x cal, the lower card's to 16 x cal x the slice), so the drawn lash is exactly the follicle's calibre.
export const LASH_CARD7 = { up: { n: 4, strand: 1 / 16 }, lo: { n: 1, strand: 1 / (16 * (LASH_SLICE[1] - LASH_SLICE[0])) } };
function growLashesFol(F, LIDS, o, fo) {
  const rnd = mulberry((o.seed ?? 1) * 433 + 17), out = [], lax = fo.lax ?? 0, A = fo.age || {}, G = (fo.groups || {})[fo.group] || {};
  const lerp3 = (a, u) => u < 0.5 ? a[0] + (a[1] - a[0]) * (u / 0.5) : a[1] + (a[2] - a[1]) * ((u - 0.5) / 0.5);
  const upv = V(0, 1, 0), rep = { L: null, R: null };
  for (const side of ['L', 'R']) {
    const lid = LIDS[side]; if (!lid || lid.upper.length < 4) continue; rep[side] = {};
    for (const [key, list, up] of [['up', lid.upper, 1], ['lo', lid.lower, -1]]) {
      const P = fo[key], m = list.length; if (!P || m < 4) continue;
      // the margin's arc length (medial -> lateral), so the follicles are spaced along the lid, not along x
      const sArc = [0]; for (let i = 1; i < m; i++) sArc.push(sArc[i - 1] + Math.hypot(list[i].x - list[i - 1].x, list[i].y - list[i - 1].y, list[i].z - list[i - 1].z));
      const Ltot = sArc[m - 1]; if (Ltot < 0.004) continue;
      const at = s => { let i = 1; while (i < m - 1 && sArc[i] < s) i++; const a = list[i - 1], b = list[i], t = clamp((s - sArc[i - 1]) / Math.max(1e-9, sArc[i] - sArc[i - 1])); return { a, b, t, mp: t < 0.5 ? a : b }; };
      const per = up > 0 ? LASH_CARD7.up.n : LASH_CARD7.lo.n, nL = P.n * (1 - (A.n ?? 0) * lax) * (G.n ?? 1) * (0.9 + 0.2 * rnd()), nC = Math.max(4, Math.round(nL / per));
      const cal = P.cal * (1 - (A.cal ?? 0) * lax) * (G.cal ?? 1), lenK = (1 - (A.len ?? 0) * lax) * (G.len ?? 1);
      const base = (P.base + (up > 0 ? (G.base ?? 0) : 0)) * Math.PI / 180, lift = (up > 0 ? P.lift * (G.lift ?? 1) : P.tip) * Math.PI / 180;
      let made = 0, lens = [];
      for (let k = 0; k < nC; k++) {
        // the lashed span: from the punctum (`bare` of the margin medially) to the lateral canthus; follicles a little sparser medially
        const q = clamp((k + 0.5 + 0.7 * (rnd() - 0.5)) / nC), u = P.bare + (1 - P.bare) * Math.pow(q, 1.12), s = u * Ltot, { a, b, t, mp } = at(s);
        const root = V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t), sp = F.surf(mp.tri, mp.b1, mp.b2);
        const row = up > 0 ? k % 2 : 0; if (row) root.add(V(0, up * (P.rowLift ?? 0.3) / 1000, -(P.rowBack ?? 0.15) / 1000));
        const tan = V(b.x - a.x, b.y - a.y, b.z - a.z); if (tan.lengthSq() < 1e-12) tan.set(Math.sign(root.x), 0, 0); tan.normalize();
        const qa = (u - P.bare) / Math.max(1e-6, 1 - P.bare), sx = Math.sign(root.x) || 1;
        const len = lerp3(P.len, qa) / 1000 * lenK * (0.88 + 0.24 * rnd()) * (up > 0 ? 1.1 : 1) * (row ? P.rowLen ?? 1 : 1);   // (upper: the tile's strands end at 0.7-1.0 of the card)
        const fan = P.fan[0] + (P.fan[1] - P.fan[0]) * qa * qa, fwd = V(sx * fan, 0, 1).normalize();
        const th0 = base + (rnd() - 0.5) * 0.12, th1 = lift + (rnd() - 0.5) * 0.25, s0 = P.straight * len, NS = 8, pts = [root.clone()], p = root.clone();
        // the curve: the shaft's direction turns toward the lid's up (or down) from the end of the straight root, fastest first and
        // easing toward the tip's angle (a growing hair's curl, set by the follicle's curvature: the direction vector gains `up` linearly)
        const d0 = fwd.clone().multiplyScalar(Math.cos(th0)).addScaledVector(upv, Math.sin(th0)), cK = Math.tan(th1) * Math.hypot(1, fan) * Math.cos(th0) - Math.sin(th0);
        for (let j = 1; j <= NS; j++) { const sm = (j - 0.5) / NS * len, tc = sm <= s0 ? 0 : (sm - s0) / Math.max(1e-6, len - s0);
          const d = d0.clone().addScaledVector(upv, cK * tc).normalize(); p.addScaledVector(d, len / NS); pts.push(p.clone()); }
        const w0 = (up > 0 ? 16 * cal : 16 * cal * (LASH_SLICE[1] - LASH_SLICE[0])) / 1000 * (0.92 + 0.16 * rnd());
        out.push({ sp, pts, tan, w0, w1: w0 * P.w1, rand: rnd(), upper: up > 0, row, ua: up > 0 ? 0 : LASH_SLICE[0], ub: up > 0 ? 1 : LASH_SLICE[1], depth: row ? 0.6 : 0.2 });
        made++; lens.push(len * 1000);
      }
      lens.sort((x, y) => x - y);
      rep[side][key] = { cards: made, lashes: made * per, marginMm: +(Ltot * 1000).toFixed(1), calMm: +cal.toFixed(3), lenMm: [+lens[0].toFixed(1), +lens[lens.length >> 1].toFixed(1), +lens[lens.length - 1].toFixed(1)] };
    }
  }
  out.fol = rep;
  return out;
}
export function growLashes(F, o = {}) {
  if (o.fol && o.eye7) return growLashesFol(F, lidMargins7(F.h, o.eye7), o, o.fol);
  const rnd = mulberry((o.seed ?? 1) * 211 + 5), out = [], LIDS = o.eye7 ? lidMargins7(F.h, o.eye7) : F.lids;
  for (const side of ['L', 'R']) {
    const lid = LIDS[side]; if (!lid || lid.upper.length < 4) continue;
    for (const [rows, list, up] of [[o.upper ?? 36, lid.upper, 1], [o.lower ?? 10, lid.lower, -1]]) {
      const m = list.length;
      for (let k = 0; k < rows; k++) {
        const u = clamp((k + 0.5 * rnd()) / rows), mp = list[Math.min(m - 1, Math.floor(u * (m - 1)))], mq = list[Math.min(m - 1, Math.floor(u * (m - 1)) + 1)];
        const sp = F.surf(mp.tri, mp.b1, mp.b2), tan = V(mq.x - mp.x, mq.y - mp.y, mq.z - mp.z); if (tan.lengthSq() < 1e-12) tan.set(Math.sign(mp.x), 0, 0); tan.normalize();
        const lat = u, Lm = up > 0 ? (0.0075 + 0.0035 * Math.sin(Math.PI * Math.min(1, lat * 0.85 + 0.15))) : (0.0026 + 0.0016 * Math.sin(Math.PI * lat)) * (lat < 0.2 ? 0.6 : 1);
        const len = Lm * (0.85 + 0.3 * rnd()) * (o.len ?? 1);
        // leave forward (the gaze), a little down for the upper lid, then curl up (lower: forward and down); fan outward at the corner
        const sx = Math.sign(mp.x), d0 = V(sx * (0.15 + 0.5 * lat * lat), up > 0 ? -0.18 : -0.75, 1).normalize(), curlA = up > 0 ? 0.95 : -0.2;
        const pts = [], p = V(mp.x, mp.y, mp.z).addScaledVector(d0, 0.0002), q = p.clone();
        const upv = V(0, 1, 0);
        for (let s = 0; s <= 4; s++) { const t = s / 4; if (s) { const d = d0.clone().addScaledVector(upv, curlA * t * 1.2).normalize(); q.addScaledVector(d, len / 4); } pts.push(q.clone()); }
        out.push({ sp, pts, tan, w0: (up > 0 ? 0.0021 : 0.0011) * (0.85 + 0.3 * rnd()), w1: up > 0 ? 0.0014 : 0.0007, rand: rnd(), upper: up > 0, row: k % 2, ua: up > 0 ? 0 : 0.35, ub: up > 0 ? 1 : 0.65 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- beards
// kind: 'stubble' (skin only) | 'short' | 'full' | 'moustache'; form: 'straight' | 'wavy' | 'curly' | 'coily'
export function growBeard(F, o = {}) {
  const kind = o.kind || 'short'; if (kind === 'stubble' || kind === 'none') return [];
  const rnd = mulberry((o.seed ?? 1) * 307 + 11), zone = beardZone(F, { ...(o.zone || {}), ...(kind === 'moustache' ? { sides: 0, chin: 0 } : {}) });
  const flow = beardFlow(F), cells = faceCells(F), form = o.form || 'straight', coily = form === 'coily', curly = form === 'curly';
  const full = kind === 'full', n = Math.round((full ? 900 : kind === 'moustache' ? 160 : 700) * (o.density ?? 1));
  const roots = sampleCells(F, cells, (p, nn) => zone(p), n, rnd);
  const cards = [];
  for (const sp of roots) {
    const chin = sstep(0.045, 0.0, Math.abs(sp.p.x)) * sstep(F.mouth.y - 0.01, F.chinY - 0.01, sp.p.y), must = sp.p.y > F.mouth.y + 0.003 && Math.abs(sp.p.x) < 0.03;
    let L = full ? (0.022 + 0.035 * chin) * (o.len ?? 1) : kind === 'moustache' || must ? 0.011 * (o.len ?? 1) : (0.0065 + 0.0035 * chin) * (o.len ?? 1);
    if (coily) L *= full ? 0.6 : 0.8; else if (curly) L *= 0.8;
    L *= 0.75 + 0.5 * rnd();
    const P = { lift: coily ? 0.55 : full ? 0.2 : 0.15, stiff: 1, comb: 0.8, grav: full ? 0.5 : 0.05, jit: coily ? 0.35 : 0.15, off0: 0.0006, off1: full ? 0.012 * (coily ? 1.4 : 1) : 0.0025, segLen: 0.004, maxSeg: full ? 10 : 4, hat: false };
    const g = growStrand(F, sp, L, P, rnd, flow);
    let pts = g.pts;
    if (coily || curly) pts = curlPts(F, pts, { A: coily ? 0.0016 : 0.0028, lam: coily ? 0.004 : 0.01, ph: rnd() * 6.28, kind: 'curl', ramp: 0.003, off: 0.0005 });
    // at the cheek line (the zone ends a few mm above the root) a card starts narrow, so the line is a soft edge of hairs, not blocks
    const edge = 1 - zone(sp.p.clone().add(V(0, 0.006, 0)));
    cards.push({ sp, pts, w0: (full ? 0.007 : 0.0045) * (0.8 + 0.4 * rnd()) * (1 - 0.6 * edge), w1: full ? 0.003 : 0.0025, rand: rnd(), depth: rnd(), tile: coily ? (rnd() < 0.5 ? 'coily' : 'coilyFuzz') : full ? 'beardLong' : 'beard', must });
  }
  return cards;
}
export { faceCells };
