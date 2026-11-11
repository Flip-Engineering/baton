// TRUE SCALE / CORESTACK (8 Oct 2026; built for THE CORE, TRUE SCALE ep. 1; research/series/machine/ep1_brief.md, BIBLE.md 3.7):
// a three-limb core-form power transformer core built lamination by lamination to real dimensions, the way a crew lays it, and the
// lay-in that joins this episode's shots. Nothing is scaled for legibility: the camera moves instead. Every query is a pure function
// of its arguments and t (nothing carried between frames), so stills, --from renders and the farm agree. This is the series engine's
// first file (lib/fx/truescale/); it is TRUE SCALE's own and is not offered to other series. research/capabilities/truescale.md.
//
//   import { CoreStack, planRig, goSteelMaterial, pressboardCard, layInQuad, LayStack } from '../lib/fx/truescale/corestack.js';
//   const core = new CoreStack({ D: 1.10, window: [1.25, 2.45], t: 0.27e-3, sf: 0.97, packets: 'auto', k: 11, steps: 7, step: 5.08e-3,
//                                book: 2, gap: 2e-3, deck: 0.80, ducts: [...] });          (new CoreStack(THREE, opts) also works)
//   core.count          -> { sheets, layers, height, mass, fill, steelArea, pathLen, packets }   ~3,900 sheets, ~123 t at the defaults
//   core.layer(i)       -> { i, y, packet, w, step, o, sheets: [{ part: 'yokeT'|'yokeB'|'limbL'|'limbC'|'limbR', poly: [[x, z]...] }] }
//   core.mesh(upto, o)  -> Group: every sheet laid below sheet `upto`: the top `o.detail` sheets as real slabs (their own step-lap
//                          joints and gaps), the rest as one stepped solid per packet; materials goSteelMaterial (rolling along each part)
//   core.lay(k, { t0, dur, part, crew, from, lift }) -> (t) => { T: Matrix4, phase: 'carry'|'lower'|'tap'|'set', grips: [{ side, pW }] }
//                          sheet k carried, lowered, tapped twice and set; at t0 + dur T is the identity (the sheet's layer() place)
//   core.upright({ windings: { od, id, h }, done, base }) -> Group: the active part standing: three windings, the limb tops as stepped
//                          circles of lamination edges, the top yoke laced from one face to `done` (0..1) of the stack
//   core.relace(n, t, o) -> { T, grips } for the n-th handful of top-yoke books lowered edge-on into place; core.yokeDone(t, o) -> 0..1
//                          rising in steps of 1/books
//   planRig({ width, center, ref, lens }) -> { camera, push(width), track(x, z), pxPerM() }: straight down, screen up = world -Z; there is
//                          no rotation API (the series' camera never rotates). lens: 600 (mm, the default: a long lens close enough to plan
//                          for the light pipeline's screen-space passes) | 'ortho' (an OrthographicCamera)
//   goSteelMaterial({ roll: 'x'|'z', scribe: 5e-3, sheen: 0, edge: 1 }) -> grain-oriented steel: satin grey, the highlight drawn out
//                          along the rolling direction, faint laser-scribe lines across it, bright sheared edges; no tint (sheen 0)
//   pressboardCard({ lines, w, h, ppm, seed, canvas }) -> { canvas, mesh(THREE) }: black ink printed on transformer pressboard (fibre,
//                          a slight ink spread), in the plan; lines: [{ text, font (opentype), cap (px), x, base (px) }]
//   layInQuad({ edge, k, t0, dur, step, crooked, seed }, t) -> the lamination matte at t: a strip with a 45-degree leading mitre sliding
//                          in and settling `step` x (k mod 7) px off its entry edge (crooked > 0: off-step and up to 1.5 deg out of square)
//   new LayStack(layers).at(t) -> the layers visible at t, bottom to top, each with its matte (the stair of the last k mod 7 slivers)
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const easeOut = u => 1 - Math.pow(1 - clamp(u), 3);
const easeInOut = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const R2 = Math.SQRT2;
export function mulberry(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- polygons in the plan (x, z)
export function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length]; a += x0 * z1 - x1 * z0; } return a / 2; }
// clip a convex or simple polygon to the half-plane a x + b z <= c (Sutherland-Hodgman)
export function clipHalf(poly, a, b, c) {
  const out = [], f = p => a * p[0] + b * p[1] - c;
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], fp = f(P), fq = f(Q);
    if (fp <= 0) out.push(P);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const u = fp / (fp - fq); out.push([P[0] + (Q[0] - P[0]) * u, P[1] + (Q[1] - P[1]) * u]); }
  }
  return out;
}
export function pointInPoly(x, z, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }

// ---------------------------------------------------------------- the stepped circle: k packet widths per half, fitted to the circle
// Band j spans heights [y_{j-1}, y_j] from the axis with width w_j = 2 sqrt(R^2 - y_j^2) (its corners on the circle); the y_j that
// maximise the area are found by coordinate ascent, the widths cut down to whole `quant` (slitting widths), then each packet given a
// whole number of sheets that keeps its corners inside the circle.
export function fitPackets(D, k = 11, t = 0.27e-3, sf = 0.97, quant = 0.005) {
  const R = D / 2, area = y => { let a = 0, prev = 0; for (let j = 0; j < y.length; j++) { a += (y[j] - prev) * 2 * Math.sqrt(Math.max(0, R * R - y[j] * y[j])); prev = y[j]; } return a; };
  const y = Array.from({ length: k }, (_, j) => R * Math.sin((j + 1) * Math.PI / (2 * (k + 1))));
  for (let it = 0; it < 400; it++) for (let j = 0; j < k; j++) {
    const lo = j ? y[j - 1] : 0, hi = j < k - 1 ? y[j + 1] : R; let best = y[j], bv = area(y);
    for (let s = 0; s <= 40; s++) { const c = lo + (hi - lo) * s / 40; y[j] = c; const v = area(y); if (v > bv) { bv = v; best = c; } }
    const span = (hi - lo) / 40; for (let s = -10; s <= 10; s++) { const c = clamp(best + span * s / 10, lo, hi); y[j] = c; const v = area(y); if (v > bv) { bv = v; best = c; } }
    y[j] = best;
  }
  const lam = t / sf, packets = []; let Y = 0;
  for (let j = 0; j < k; j++) {
    const w = Math.floor(2 * Math.sqrt(Math.max(0, R * R - y[j] * y[j])) / quant + 1e-9) * quant;
    if (w <= 0) continue;
    const yMax = Math.sqrt(Math.max(0, R * R - (w / 2) * (w / 2))), n = Math.floor((yMax - Y) / lam + 1e-9);
    if (n <= 0) continue;
    packets.push({ w: +w.toFixed(4), n }); Y += n * lam;
  }
  return packets;                                   // widest first (at the axis), one half; the other half mirrors it
}

// ---------------------------------------------------------------- the core
export class CoreStack {
  constructor(a, b) {
    const o = (a && a.Vector3 && a.Matrix4) ? (b || {}) : (a || {});   // new CoreStack(THREE, opts) or new CoreStack(opts)
    const S = this.o = { D: 1.10, window: [1.25, 2.45], t: 0.27e-3, sf: 0.97, packets: 'auto', k: 11, quant: 0.005, steps: 7, step: 5.08e-3, book: 2,
      gap: 2e-3, mitre: 45, vNotch: true, deck: 0.80, ducts: null, rho: 7650, ...o };
    this.P = S.D + S.window[0];                       // limb pitch (2.35 m at the defaults)
    this.Zy = S.window[1] / 2 + S.D / 2;              // yoke centrelines at z = -Zy (top, up-screen) and +Zy (bottom)
    this.L = 2 * this.P + S.D;                        // yoke length (5.80 m)
    this.lam = S.t / S.sf;                            // one sheet's share of the stack height
    const half = Array.isArray(S.packets) ? S.packets.map(p => ({ w: p.w, n: p.n })) : fitPackets(S.D, S.k, S.t, S.sf, S.quant);
    // bottom to top: the lower half narrowest first, then the upper half widest first
    const seq = [...half.slice().reverse().map((p, j) => ({ ...p, j: half.length - 1 - j })), ...half.map((p, j) => ({ ...p, j }))];
    let s0 = 0; this.packs = seq.map((p, q) => { const r = { q, j: p.j, w: p.w, n: p.n, s0, s1: s0 + p.n }; s0 += p.n; return r; });
    this.N = s0;
    // cooling ducts (oil channels): pressboard spacer layers at packet boundaries (default: two each half, between the widest packets)
    const ducts = S.ducts ?? [1, 3].flatMap(j => { const lo = this.packs.find(p => p.j === j && p.q < half.length), hi = this.packs.find(p => p.j === j && p.q >= half.length); return [lo && { atSheet: lo.s1, thick: 6e-3 }, hi && { atSheet: hi.s0, thick: 6e-3 }].filter(Boolean); });
    this.ducts = ducts.slice().sort((p, q) => p.atSheet - q.atSheet);
    // the record
    const lam = this.lam, circ = Math.PI * S.D * S.D / 4;
    const steelArea = this.packs.reduce((a, p) => a + p.n * S.t * p.w, 0), geo = this.packs.reduce((a, p) => a + p.n * lam * p.w, 0);
    const pathLen = 3 * S.window[1] + 2 * this.L, height = this.yOf(this.N) - S.deck;
    this.count = { sheets: this.N, layers: this.N, books: Math.ceil(this.N / S.book), height, mass: steelArea * pathLen * S.rho, fill: geo / circ, steelArea, pathLen,
      packets: half.length, widths: half.map(p => p.w), stackNoDucts: this.N * lam, D: S.D };
  }
  // the deck-relative height of sheet i's underside (ducts below it included)
  yOf(i) { let y = this.o.deck + i * this.lam; for (const d of this.ducts) if (d.atSheet <= i) y += d.thick; return y; }
  packOf(i) { const P = this.packs; if (i <= 0) return P[0]; if (i >= this.N) return P[P.length - 1]; let lo = 0, hi = P.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].s1 <= i) lo = m + 1; else hi = m; } return P[lo]; }
  stepOf(i) { const S = this.o; return Math.floor(i / S.book) % S.steps; }
  offsetOf(i) { return this.stepOf(i) * this.o.step; }
  // the five sheets of one layer: polygons in the plan (x right, z down-screen), metres
  parts(w, o, g = this.o.gap) {
    const h = w / 2, P = this.P, Zy = this.Zy, Zt = -Zy, Zb = Zy, d = o * R2, gq = g / R2, gh = g / 2;
    // outer corners: the mitre x - z = -P - Zt shifted o along (1,-1)/sqrt2; the yoke on its +x side, the limb on its -x side
    const cY = -P - Zt + d + gq, cL = -P - Zt + d - gq;
    // the centre T: the V apex shifted d into the yoke; its flanks x - z = c1, x + z = c2
    const c1Y = -Zt + d + gq, c2Y = Zt - d - gq, c1L = -Zt + d - gq, c2L = Zt - d + gq;
    const A = [cY + Zt - h, Zt - h], B = [cY + Zt + h, Zt + h], Ar = [-(cY + Zt - h), Zt - h], Br = [-(cY + Zt + h), Zt + h];
    const sx = h + gh, zRS = sx - c1Y, zLS = c2Y + sx, apY = [0, (c2Y - c1Y) / 2];
    const yokeT = [A, Ar, Br, [sx, Zt + h], [sx, zRS], apY, [-sx, zLS], [-sx, Zt + h], B];
    const yokeB = yokeT.map(([x, z]) => [x, -z]).reverse();
    const apL = (c2L - c1L) / 2, shL = h - c1L;       // the limb's V apex and its shoulders (z), top end; the bottom mirrors
    const limbC = [[0, apL], [h, shL], [h, -shL], [0, -apL], [-h, -shL], [-h, shL]];
    let limbL = [[-P - h, Zt - h], [-P + h, Zt - h], [-P + h, Zb + h], [-P - h, Zb + h]];
    limbL = clipHalf(limbL, 1, -1, cL); limbL = clipHalf(limbL, 1, 1, cL);
    const limbR = limbL.map(([x, z]) => [-x, z]).reverse();
    return [{ part: 'yokeT', poly: yokeT }, { part: 'yokeB', poly: yokeB }, { part: 'limbL', poly: limbL }, { part: 'limbC', poly: limbC }, { part: 'limbR', poly: limbR }];
  }
  layer(i) { const p = this.packOf(i), o = this.offsetOf(i); return { i, y: this.yOf(i), packet: p.q, j: p.j, w: p.w, step: this.stepOf(i), o, sheets: this.parts(p.w, o) }; }
  // the packet's outline (the whole frame shape at width w, no joints): outer rectangle and two windows, for the stepped solids
  outline(w) { const h = w / 2, P = this.P, Zy = this.Zy;
    return { outer: [[-P - h, -Zy - h], [P + h, -Zy - h], [P + h, Zy + h], [-P - h, Zy + h]],
      holes: [[[-P + h, -Zy + h], [-h, -Zy + h], [-h, Zy - h], [-P + h, Zy - h]], [[h, -Zy + h], [P - h, -Zy + h], [P - h, Zy - h], [h, Zy - h]]] }; }

  // ---------------------------------------------------------------- meshes
  // mesh(upto, { detail, parts, from, mats }): sheets [from, upto) of the chosen parts; the top `detail` as real slabs
  mesh(upto, o = {}) {
    const S = this.o, detail = o.detail ?? 14, from = o.from ?? 0, keep = o.parts ? new Set(o.parts) : null, g = new THREE.Group(); g.name = 'corestack';
    upto = Math.max(from, Math.min(this.N, Math.round(upto)));
    const mats = o.mats || { x: goSteelMaterial({ roll: 'x' }), z: goSteelMaterial({ roll: 'z' }), duct: pressboardMaterial() };
    const cut = Math.max(from, upto - detail), bx = new GeoBuf(), bz = new GeoBuf(), bd = new GeoBuf();
    // the stepped solids: one prism per packet (or the part of it below the slabs); the whole frame shape when all five parts are kept
    for (const p of this.packs) {
      const a = Math.max(p.s0, from), b = Math.min(p.s1, cut); if (b <= a) continue;
      const y0 = this.yOf(a), y1 = this.yOf(b) - (this.ducts.some(d => d.atSheet === b) ? this.ducts.find(d => d.atSheet === b).thick : 0);
      const tn = toneOf(p.q * 31 + 7);
      if (!keep) { const ol = this.outline(p.w); bx.prism(ol.outer, ol.holes, y0, y1, 'x', tn); }
      else for (const s of this.parts(p.w, 0, 0)) if (keep.has(s.part)) (s.part.startsWith('yoke') ? bx : bz).prism(s.poly, [], y0, y1, s.part.startsWith('yoke') ? 'x' : 'z', tn);
    }
    // ducts: pressboard spacers (strips along each part) in the oil channel
    for (const d of this.ducts) if (d.atSheet > from && d.atSheet <= cut) {
      const y0 = this.yOf(d.atSheet) - d.thick, p = this.packOf(d.atSheet);
      for (const st of ductStrips(this, p.w)) if (!keep || keep.has(st.part)) bd.prism([[st.x0, st.z0], [st.x1, st.z0], [st.x1, st.z1], [st.x0, st.z1]], [], y0, y0 + d.thick, 'x');
    }
    // the slabs: each sheet's five parts with its own step-lap offset and joint gaps
    for (let i = cut; i < upto; i++) {
      const L = this.layer(i), y0 = L.y, y1 = L.y + this.lam;
      for (const s of L.sheets) { if (keep && !keep.has(s.part)) continue; (s.part.startsWith('yoke') ? bx : bz).prism(s.poly, [], y0, y1, s.part.startsWith('yoke') ? 'x' : 'z', toneOf(i * 5 + s.part.length)); }
    }
    for (const [buf, m, nm] of [[bx, mats.x, 'yokes'], [bz, mats.z, 'limbs'], [bd, mats.duct, 'ducts']]) {
      if (!buf.n) continue; const me = new THREE.Mesh(buf.geometry(), m); me.name = nm; me.castShadow = me.receiveShadow = true; g.add(me);
    }
    g.userData = { upto, from, detail, top: this.yOf(upto) };
    return g;
  }
  // the sheet that is being laid: one part of layer k as its own mesh (lay() moves it)
  sheetMesh(k, part = 'yokeT', mats = null) {
    const L = this.layer(k), s = L.sheets.find(q => q.part === part), b = new GeoBuf(), roll = part.startsWith('yoke') ? 'x' : 'z';
    b.prism(s.poly, [], L.y, L.y + this.lam, roll, 0.85);   // the new sheet: fresh from the slitting line, a shade brighter
    const m = new THREE.Mesh(b.geometry(), (mats && mats[roll]) || goSteelMaterial({ roll })); m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false;
    m.userData = { k, part, poly: s.poly, y: L.y }; return m;
  }

  // ---------------------------------------------------------------- laying a sheet
  // lay(k, { t0, dur, part, crew, from: [dx, dz] (where it is carried from, relative), lift (m above its place) }) -> (t) => state
  // carry 0-0.35 (from -> over its place, at `lift`), lower 0.35-0.7 (to 4 mm over), tap 0.7-0.88 (two 3 mm nudges along its length onto
  // the joint, as a crew squares a sheet), set 0.88-1 (down; hands come off). T moves the sheet from its place; at t0 + dur T = identity.
  lay(k, { t0 = 0, dur = 3, part = 'yokeT', crew = 8, from = [0, -0.6], lift = 0.22 } = {}) {
    const L = this.layer(k), s = L.sheets.find(q => q.part === part), poly = s.poly;
    const along = part.startsWith('yoke') ? 'x' : 'z', xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }, yTop = L.y + this.lam;
    // grips: n points on the two long edges, spaced along it (the window edge only where the sheet faces a window)
    const grips0 = [], nS = Math.ceil(crew / 2), nN = crew - nS;
    const spots = (n, a, b) => Array.from({ length: n }, (_, q) => n === 2 ? (q ? b : a) : a + (b - a) * (q + 0.5) / n);   // two in a window: at its ends
    if (along === 'x') {
      const isT = part === 'yokeT', outer = isT ? box.z0 : box.z1, inner = isT ? box.z1 : box.z0, inX = [[-this.P + L.w / 2 + 0.35, -L.w / 2 - 0.35], [L.w / 2 + 0.35, this.P - L.w / 2 - 0.35]];   // where a worker can stand in a window
      for (const x of spots(nS, box.x0 + 0.35, box.x1 - 0.35)) grips0.push({ side: 'out', p: [x, outer] });
      const perWin = Math.ceil(nN / 2); inX.forEach(([a, b], wi) => { for (const x of spots(Math.min(perWin, nN - wi * perWin), a, b)) grips0.push({ side: 'in', p: [x, inner] }); });
    } else {
      const zw = this.o.window[1] / 2 - 0.3;                         // along a limb: within the window's height, where the crew stands
      for (const z of spots(nS, -zw, zw)) grips0.push({ side: 'W', p: [box.x0, z] });
      for (const z of spots(nN, -zw, zw)) grips0.push({ side: 'E', p: [box.x1, z] });
    }
    const M = new THREE.Matrix4();
    return (t) => {
      const u = clamp((t - t0) / dur);
      let dx = 0, dz = 0, dy = 0, phase;
      if (u < 0.35) { const v = easeInOut(u / 0.35); phase = 'carry'; dx = from[0] * (1 - v); dz = from[1] * (1 - v); dy = lift; }
      else if (u < 0.7) { const v = easeInOut((u - 0.35) / 0.35); phase = 'lower'; dy = lift + (0.004 - lift) * v; }
      else if (u < 0.88) { const v = (u - 0.7) / 0.18; phase = 'tap'; dy = 0.004; const tap = Math.max(0, Math.sin(v * Math.PI * 2)) * 0.003 * (1 - v); if (along === 'x') dx = tap * (part === 'yokeT' ? 1 : -1); else dz = tap; }
      else { const v = easeOut((u - 0.88) / 0.12); phase = 'set'; dy = 0.004 * (1 - v); }
      M.makeTranslation(dx, dy, dz);
      const grips = grips0.map(g => ({ side: g.side, pW: new THREE.Vector3(g.p[0] + dx, yTop + dy, g.p[1] + dz), on: phase !== 'set' || u < 0.94 }));
      return { T: M.clone(), phase, u, grips };
    };
  }

  // ---------------------------------------------------------------- the active part, standing
  // The flat core turned upright: plan z (down-screen) becomes height (the top yoke up), the stack becomes depth (world z). From above
  // the limb tops are the stepped circles (the packets' widths across the stack); the top yoke is laced from the stack's -z face to `done`.
  uprightFrame(base = 0.3) { // the matrix from the flat core (deck at this.o.deck) to the standing one, its foot at y = base
    const H = this.yOf(this.N) - this.o.deck;
    return new THREE.Matrix4().makeTranslation(0, base + this.Zy + this.o.D / 2, -H / 2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(0, -this.o.deck, 0));
  }
  upright({ windings = { od: 2.30, id: 1.14, h: null }, done = 1, base = 0.3, mats = null, detail = 0 } = {}) {
    const S = this.o, g = new THREE.Group(); g.name = 'activePart';
    const core = new THREE.Group(); core.matrixAutoUpdate = false; core.matrix.copy(this.uprightFrame(base));
    const ms = mats || { x: goSteelMaterial({ roll: 'x' }), z: goSteelMaterial({ roll: 'z' }), duct: pressboardMaterial() };
    core.add(this.mesh(this.N, { detail, parts: ['yokeB', 'limbL', 'limbC', 'limbR'], mats: ms }));
    const yoke = this.mesh(Math.round(this.N * clamp(done)), { detail: 0, parts: ['yokeT'], mats: ms }); yoke.name = 'topYoke'; core.add(yoke);
    g.add(core); g.userData.core = core; g.userData.yoke = yoke;
    // the windings: concentric pressboard-wrapped cylinders round each limb, end rings with radial spacer blocks, copper leads at the top
    const hw = Math.min(windings.h ?? 99, S.window[1] - 0.15), y0 = base + S.D + (S.window[1] - hw) / 2;
    for (const x of [-this.P, 0, this.P]) g.add(winding(x, y0, windings.od, windings.id, hw, x));
    g.userData.windingTop = y0 + hw; g.userData.top = base + 2 * this.Zy + S.D / 2 + this.packs.reduce((m, p) => Math.max(m, p.w), 0) / 2; g.userData.depth = this.yOf(this.N) - S.deck;
    g.userData.topAt = w => base + 2 * this.Zy + S.D / 2 + w / 2;   // the yoke's top over a packet of width w (the stepped circle, standing)
    return g;
  }
  // lacing: the top yoke's books go in edge-on from above, between the limb fingers, the band growing from the stack's -z face to its
  // +z face. The crew lowers them a handful at a time, one handful a `cycle` (s); a handful's books settle one by one as it is pressed
  // home (0.55-0.9 of the cycle), so the band grows in steps of one book. o: { t0, t1, from (the done share at t0), cycle }
  lacePlan({ t0 = 0, t1 = 6.3, from = 0.85, cycle = 1.05 } = {}) {
    const books = Math.ceil(this.N / this.o.book), b0 = Math.round(from * books), nC = Math.max(1, Math.round((t1 - t0) / cycle));
    return { books, b0, nC, per: (books - b0) / nC, t0, t1: t0 + nC * cycle, cycle };
  }
  yokeDone(t, o = {}) {
    const L = this.lacePlan(o);
    if (t <= L.t0) return L.b0 / L.books; if (t >= L.t1) return 1;
    const c = Math.floor((t - L.t0) / L.cycle), u = (t - L.t0 - c * L.cycle) / L.cycle;
    return Math.min(L.books, Math.floor(L.b0 + L.per * c + L.per * sstep(0.55, 0.9, u) + 1e-9)) / L.books;
  }
  // the n-th handful at t: T (its lift over its seat), the crew's grips on its top edge (two at each limb's gap), u (0..1 of its cycle)
  relace(n, t, o = {}) {
    const L = this.lacePlan(o), base = o.base ?? 0.3, H = this.yOf(this.N) - this.o.deck, u = clamp((t - L.t0 - n * L.cycle) / L.cycle);
    const zFace = -H / 2 + H * (L.b0 + L.per * n) / L.books, thick = H * L.per / L.books;
    const top = base + 2 * this.Zy + this.o.D / 2 + this.packs.reduce((m, p) => Math.max(m, p.w), 0) / 2, lift = u < 0.25 ? 0.35 : u < 0.55 ? 0.35 * (1 - easeInOut((u - 0.25) / 0.3)) : 0;
    // c20: the handful comes from the crew's side (+z, over the lacing boards) and is carried across to its seat before it goes down, so
    // from straight above the act is seen (a lift alone barely shows in plan): approach (o.approach m) over 0-0.3 of the cycle
    // the crew works from the platform nearer the handful (o.sides: the -z platform for the stack's first half, the +z boards after)
    const near = o.sides && zFace + thick / 2 < 0 ? -1 : 1;
    const ap = o.approach ?? 0, dz = near * ap * (1 - easeInOut(clamp(u / 0.3)));
    const T = new THREE.Matrix4().makeTranslation(0, lift, dz), gz = near < 0 ? zFace - 0.012 : zFace + thick + 0.012;
    const grips = [-this.P, 0, this.P].flatMap(x => [-0.35, 0.35].map(dx => ({ side: dx < 0 ? 'L' : 'R', pW: new THREE.Vector3(x + dx, top + lift - 0.02, gz + dz), on: u < 0.9 })));
    return { T, grips, u, zFace, thick, top, lift, dz, near };
  }
}

// a sheet's or a packet's own shade (0..1), seeded: coils from different heats are never quite the same grey
function toneOf(seed) { return mulberry((seed * 2654435761) >>> 0)(); }
// the cooling-duct spacers: strips 30 mm wide every 0.25 m along each leg, in the duct's plane
function ductStrips(C, w) {
  const out = [], h = w / 2, P = C.P, Zy = C.Zy, s = 0.03;
  for (let x = -P - h + 0.1; x < P + h - 0.1; x += 0.25) for (const zc of [-Zy, Zy]) out.push({ part: zc < 0 ? 'yokeT' : 'yokeB', x0: x, x1: x + s, z0: zc - h, z1: zc + h });
  for (const xc of [-P, 0, P]) for (let z = -Zy + h + 0.1; z < Zy - h - 0.1; z += 0.25) out.push({ part: xc < 0 ? 'limbL' : xc > 0 ? 'limbR' : 'limbC', x0: xc - h, x1: xc + h, z0: z, z1: z + s });
  return out;
}

// ---------------------------------------------------------------- prisms into one buffer: positions, normals, uv (u along the rolling
// direction, metres), aEdge (1 on the cut faces, 0 on the rolled faces)
class GeoBuf {
  constructor() { this.P = []; this.N = []; this.U = []; this.E = []; this.T = []; this.n = 0; this.tone = 0.5; }
  tri(a, b, c, nrm, roll, edge) { for (const p of [a, b, c]) { this.P.push(p[0], p[1], p[2]); this.N.push(nrm[0], nrm[1], nrm[2]); this.U.push(roll === 'x' ? p[0] : p[2], roll === 'x' ? p[2] : p[0]); this.E.push(edge); this.T.push(this.tone); } this.n += 3; }
  // a prism: outer contour (and holes) in the plan, from y0 to y1; tone (0..1): this prism's own shade (c20: one sheet is not its neighbour)
  prism(outer, holes, y0, y1, roll = 'x', tone = 0.5) {
    this.tone = tone;
    const o = polyArea(outer) < 0 ? outer.slice().reverse() : outer, hs = holes.map(h => (polyArea(h) > 0 ? h.slice().reverse() : h));
    const v2 = p => new THREE.Vector2(p[0], p[1]), tris = THREE.ShapeUtils.triangulateShape(o.map(v2), hs.map(h => h.map(v2))), all = [...o, ...hs.flat()];
    // each triangle made counter-clockwise in (x, z) first; then the top face (+y) is wound a, c, b (front-facing seen from above with
    // the plan rig's screen up = -z) and the bottom face a, b, c
    for (let [a, b, c] of tris) { let A = all[a], B = all[b], C = all[c];
      if (polyArea([A, B, C]) < 0) { const q = B; B = C; C = q; }
      this.tri([A[0], y1, A[1]], [C[0], y1, C[1]], [B[0], y1, B[1]], [0, 1, 0], roll, 0);
      this.tri([A[0], y0, A[1]], [B[0], y0, B[1]], [C[0], y0, C[1]], [0, -1, 0], roll, 0); }
    // the walls: outward normals (the right-hand perpendicular of a counter-clockwise ring; a hole's ring runs clockwise)
    for (const ring of [o, ...hs]) for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez); if (L < 1e-9) continue;
      const nrm = [ez / L, 0, -ex / L];
      const a = [p[0], y0, p[1]], b = [q[0], y0, q[1]], c = [q[0], y1, q[1]], d = [p[0], y1, p[1]];
      this.tri(a, c, b, nrm, roll, 1); this.tri(a, d, c, nrm, roll, 1);
    }
  }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('aEdge', new THREE.Float32BufferAttribute(this.E, 1)); g.setAttribute('aTone', new THREE.Float32BufferAttribute(this.T, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
}
export { GeoBuf };

// ---------------------------------------------------------------- a winding seen from above: pressboard cylinder, end ring, spacer blocks,
// copper leads (scene scale, metres)
function winding(x, y0, od, id, h, seed) {
  const g = new THREE.Group(); g.name = 'winding';
  const board = pressboardMaterial({ tone: 0 }), dark = pressboardMaterial({ tone: -0.25 }), copper = copperMaterial();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(od / 2, od / 2, h, 96, 1, true), board); shell.position.set(x, y0 + h / 2, 0); g.add(shell);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(id / 2, id / 2, h, 64, 1, true), dark); inner.position.copy(shell.position); inner.material.side = THREE.DoubleSide; g.add(inner);
  // the winding's own turns between the end rings, seen through the radial ducts (dark)
  const ring = new THREE.Mesh(new THREE.RingGeometry(id / 2, od / 2, 96, 1).rotateX(-Math.PI / 2), board); ring.position.set(x, y0 + h + 0.02, 0); g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(id / 2 + 0.03, od / 2 - 0.03, 96, 1).rotateX(-Math.PI / 2), dark); ring2.position.set(x, y0 + h, 0); g.add(ring2);
  // radial spacer blocks on the end ring (24), 40 x 25 mm, 35 mm high
  const nb = 24, blocks = [];
  for (let i = 0; i < nb; i++) { const a = (i + 0.5) / nb * Math.PI * 2, rr = (od + id) / 4, len = (od - id) / 2 - 0.04;
    const b = new THREE.BoxGeometry(len, 0.035, 0.04); b.rotateY(-a); b.translate(x + Math.cos(a) * rr, y0 + h + 0.02 + 0.0175, Math.sin(a) * rr); blocks.push(b); }
  const bm = new THREE.Mesh(mergeBuffers(blocks), pressboardMaterial({ tone: 0.08 })); g.add(bm);
  // the leads: copper bars rising from the top (two, at the back of the winding), paper-wrapped where they leave the coil
  for (const [a, len] of [[-2.2 - 0.3 * Math.sin(seed), 0.35], [-2.55 - 0.3 * Math.sin(seed), 0.28]]) {   // at the back (-z)
    const rr = od / 2 - 0.12, cx = x + Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const lead = new THREE.Mesh(new THREE.BoxGeometry(0.03, len, 0.012), copper); lead.position.set(cx, y0 + h + len / 2, cz); g.add(lead);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 12), pressboardMaterial({ tone: 0.12 })); wrap.position.set(cx, y0 + h + 0.05, cz); g.add(wrap);
  }
  g.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
  return g;
}
function mergeBuffers(gs) { // positions + normals only (BoxGeometry parts)
  let n = 0; for (const g of gs) n += (g.index ? g.index.count : g.attributes.position.count);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
  for (const g0 of gs) { const g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position.array, q = g.attributes.normal.array; P.set(p, o * 3); N.set(q, o * 3); o += p.length / 3; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); return out;
}

// ---------------------------------------------------------------- materials
const NOISE_GLSL = /* glsl */`
float tsH(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tsN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(tsH(i), tsH(i + vec2(1, 0)), f.x), mix(tsH(i + vec2(0, 1)), tsH(i + vec2(1, 1)), f.x), f.y); }
`;
// Grain-oriented electrical steel (GO: Goss texture, a phosphate/glass insulation coat): satin light grey, the highlight drawn out along
// the rolling direction (the uv's u), laser-scribe lines across it every `scribe` m (faint; faded to their mean once a pixel covers a
// line, so they never alias), bright sheared edges on the cut faces (aEdge). The interference tint stays off (sheen 0) unless reference
// photographs show one.
export function goSteelMaterial({ roll = 'x', scribe = 5e-3, sheen = 0, edge = 1, color = '#9da1a4', rough = 0.34, lam = 0.27e-3 / 0.97, tone = 1 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.78, roughness: rough, anisotropy: 0.65, anisotropyRotation: 0, clearcoat: 0.35, clearcoatRoughness: 0.42,
    sheen: sheen > 0 ? 0.25 * sheen : 0, sheenColor: new THREE.Color('#9d8fb4'), sheenRoughness: 0.5 });
  const U = { tsScribe: { value: scribe }, tsEdge: { value: edge }, tsLam: { value: lam }, tsToneK: { value: tone } };
  // c20 (15 Oct): the steel as a book of sheets. Each packet and each loose sheet its own shade (aTone), so a lap, a terrace or a joint
  // shows as one sheet against another; the roll's streaks drawn out ALONG the rolling direction; on the cut faces, the sheets' edges
  // themselves: bright sheared steel, one line per sheet with the dark insulation coat between, each sheet's edge a little different, the
  // step-lap's 14-sheet cycle faintly; every line fades to its mean once it is under a pixel, so nothing aliases at any push.
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEdge; attribute float aTone; varying float vEdge; varying float vTone; varying vec2 vTsUv; varying float vTsY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge; vTone = aTone; vTsUv = uv; vTsY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEdge; varying float vTone; varying vec2 vTsUv; varying float vTsY; uniform float tsScribe, tsEdge, tsLam, tsToneK;' + NOISE_GLSL)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{ float fw = fwidth(vTsUv.x) / tsScribe;                                       // pixels per scribe spacing, inverted
  float ln = 1.0 - smoothstep(0.0, 0.12, abs(fract(vTsUv.x / tsScribe) - 0.5) * 2.0 - 0.76);
  float sc = mix(ln, 0.14, smoothstep(0.25, 0.9, fw));                          // to its mean once a line is under a pixel
  float fs = fwidth(vTsUv.y) * 160.0;                                           // the streaks' own fade
  float streak = mix(tsN(vTsUv * vec2(0.7, 160.0)), 0.5, smoothstep(0.4, 1.2, fs)) * 0.55 + tsN(vTsUv * vec2(0.35, 22.0)) * 0.45;
  float top = 1.0 - vEdge;
  diffuseColor.rgb *= (0.84 + 0.28 * mix(0.5, vTone, tsToneK)) * (0.93 + 0.12 * streak) - 0.05 * sc * top;
  roughnessFactor = roughnessFactor + 0.05 * sc + 0.06 * (streak - 0.5) + 0.08 * (vTone - 0.5) * tsToneK;
  // the cut faces: the sheets' edges
  float fy = fwidth(vTsY) / tsLam;                                              // sheets per pixel
  float sheetId = floor(vTsY / tsLam);
  float lineL = smoothstep(0.62, 0.9, abs(fract(vTsY / tsLam) - 0.5) * 2.0);    // the coat between two edges
  float own = tsH(vec2(sheetId * 0.137, 3.1));                                  // each edge's own burr
  float cyc = 0.5 + 0.5 * cos(6.2831853 * vTsY / (tsLam * 14.0));               // the step-lap cycle (7 steps of 2)
  float edgeLines = mix(1.0 - 0.55 * lineL + 0.18 * (own - 0.5), 0.86, smoothstep(0.35, 0.8, fy));
  float edgeCyc = mix(0.92 + 0.08 * cyc, 0.96, smoothstep(0.35, 0.8, fy / 14.0));
  vec3 cut = vec3(0.86, 0.87, 0.875) * edgeLines * edgeCyc;
  roughnessFactor = mix(roughnessFactor, 0.16 + 0.12 * own * (1.0 - smoothstep(0.35, 0.8, fy)), vEdge * tsEdge);   // burnished, sheet by sheet
  diffuseColor.rgb = mix(diffuseColor.rgb, cut, 0.62 * vEdge * tsEdge); }`);
  };
  m.customProgramCacheKey = () => 'ts-gosteel2';
  m.userData.roll = roll; m.name = 'GO steel (' + roll + ')';
  return m;
}
// transformer pressboard (and winding paper): tan, fibrous, matte
export function pressboardMaterial({ tone = 0, color = '#c9b48f' } = {}) {
  const c = new THREE.Color(color); c.offsetHSL(0, 0, tone * 0.25);
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.86, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTsW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTsW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTsW;' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ vec2 p = vTsW.xz + vTsW.y * 0.37; float f = tsN(p * vec2(380.0, 60.0)) * 0.5 + tsN(p * 1200.0) * 0.3 + tsN(p * 25.0) * 0.2;
  diffuseColor.rgb *= 0.9 + 0.16 * f; }`);
  };
  m.customProgramCacheKey = () => 'ts-pressboard1'; m.name = 'pressboard';
  return m;
}
export function copperMaterial() { return new THREE.MeshPhysicalMaterial({ color: '#b87355', metalness: 0.9, roughness: 0.38, clearcoat: 0.1 }); }

// ---------------------------------------------------------------- the plan rig: straight down, push and track only
// width: the frame's width in metres at the reference plane y = ref; center: [x, z]; lens: mm (35 mm full-frame equivalent on the
// frame's long side) or 'ortho'. There is no rotation API: the camera's orientation is set once, here.
export function planRig({ width = 3.6, center = [0, 0], ref = 0, lens = 600, aspect = 1080 / 1920, span = 40 } = {}) {
  const ortho = lens === 'ortho', st = { width, cx: center[0], cz: center[1], ref };
  const vfov = ortho ? 0 : 2 * Math.atan(18 / lens), camera = ortho ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000) : new THREE.PerspectiveCamera(vfov * 180 / Math.PI, aspect, 1, 1000);
  camera.up.set(0, 0, -1); camera.position.set(0, 10, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const Q = camera.quaternion.clone(); Object.freeze(Q);
  const dist = w => (w / aspect / 2) / Math.tan(vfov / 2);   // the camera's height over the reference plane for a frame `w` wide
  const apply = () => {
    camera.quaternion.copy(Q);
    if (ortho) { const hw = st.width / 2, hh = hw / aspect; Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh, near: 0.1, far: 2 * span + 10 }); camera.position.set(st.cx, st.ref + span + 5, st.cz); }
    else { const d = dist(st.width); camera.position.set(st.cx, st.ref + d, st.cz); camera.near = Math.max(0.5, d - span); camera.far = d + span; }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  };
  apply();
  return {
    camera, ortho, lens,
    get width() { return st.width; }, get center() { return [st.cx, st.cz]; }, get ref() { return st.ref; },
    push(w, ref = st.ref) { st.width = w; st.ref = ref; apply(); return this; },
    track(x, z) { st.cx = x; st.cz = z; apply(); return this; },
    set(w, x, z, ref = st.ref) { st.width = w; st.cx = x; st.cz = z; st.ref = ref; apply(); return this; },
    pxPerM() { return 1080 / st.width; },
    // world -> screen px (at any height: a long lens is not quite plan; ortho is)
    toScreen(p) { const v = new THREE.Vector3(p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z).project(camera); return [(v.x + 1) / 2 * 1080, (1 - v.y) / 2 * 1920]; },
  };
}

// ---------------------------------------------------------------- pressboard cards: black ink printed on pressboard, lying in the plan
// lines: [{ text, font (an opentype.js font), cap (px), x, base (px from the top), color }]; w, h in px at the card's own ppm.
// canvas: an HTMLCanvasElement (or anything with getContext('2d')); in node pass one from a stub.
export function pressboardCard({ lines = [], w = 810, h = 390, seed = 7, canvas = null, board = '#d9cbb0', ink = '#141210', spread = 0.6, fibre = 0.08, edge = true } = {}) {
  const cv = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null); if (!cv) throw new Error('pressboardCard: no canvas');
  cv.width = Math.round(w); cv.height = Math.round(h); const g = cv.getContext('2d'), r = mulberry(seed);
  g.fillStyle = board; g.fillRect(0, 0, w, h);
  // the board: calendered fibre, long in one direction, a slight mottle, darker toward the cut edges
  for (let i = 0; i < w * h / 90; i++) { const x = r() * w, y = r() * h, L = 4 + r() * 22, a = 0.04 + 0.06 * r(); g.fillStyle = r() < 0.5 ? `rgba(90,70,40,${a})` : `rgba(255,248,230,${a})`; g.fillRect(x, y, L, 0.6 + r() * 0.6); }
  if (edge) { const e = g.createLinearGradient(0, 0, 0, h); e.addColorStop(0, 'rgba(70,52,30,0.16)'); e.addColorStop(0.04, 'rgba(70,52,30,0)'); e.addColorStop(0.96, 'rgba(70,52,30,0)'); e.addColorStop(1, 'rgba(70,52,30,0.16)'); g.fillStyle = e; g.fillRect(0, 0, w, h); }
  const shaped = [];
  for (const L of lines) {
    const f = L.font, upm = f.unitsPerEm, cap = (f.tables.os2 && f.tables.os2.sCapHeight) || upm * 0.7, size = L.cap * upm / cap;
    const glyphs = [...L.text].map(ch => f.charToGlyph(ch)); let pen = 0; const paths = [];
    glyphs.forEach((gl, i) => { const p = gl.getPath(L.x + pen, L.base, size); paths.push(p.commands); pen += (gl.advanceWidth + (i < glyphs.length - 1 ? f.getKerningValue(gl, glyphs[i + 1]) : 0)) * size / upm; });
    shaped.push({ ...L, size, width: pen, paths });
    const trace = () => { g.beginPath(); for (const cmds of paths) for (const c of cmds) { if (c.type === 'M') g.moveTo(c.x, c.y); else if (c.type === 'L') g.lineTo(c.x, c.y); else if (c.type === 'Q') g.quadraticCurveTo(c.x1, c.y1, c.x, c.y); else if (c.type === 'C') g.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y); else if (c.type === 'Z') g.closePath(); } };
    // ink spread: a soft halo of the ink round the letter (the board drinks it), then the letter
    g.save(); g.fillStyle = L.color || ink; g.globalAlpha = 0.35; g.lineJoin = 'round'; g.strokeStyle = L.color || ink; g.lineWidth = spread * 2; trace(); g.stroke(); g.restore();
    g.save(); g.fillStyle = L.color || ink; trace(); g.fill(); g.restore();
  }
  // the board's fibre through the ink (about 8 %): light flecks over everything, strongest on the ink
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < w * h / 160; i++) { const x = r() * w, y = r() * h; g.fillStyle = `rgba(40,34,24,${fibre * (0.5 + r())})`; g.fillRect(x, y, 1 + r() * 5, 0.7); }
  g.restore();
  return {
    canvas: cv, w, h, lines: shaped,
    // a mesh lying in the plan (its own 3 mm board), ppm px per metre
    mesh(T = THREE, ppm = 300, thick = 3e-3) {
      const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
      const W = w / ppm, H = h / ppm, geo = new T.BoxGeometry(W, thick, H), face = new T.MeshStandardMaterial({ map: tex, roughness: 0.84, metalness: 0 }), side = pressboardMaterial({ tone: -0.1 });
      const mesh = new T.Mesh(geo, [side, side, face, side, side, side]); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.card = true; return mesh;
    },
  };
}

// ---------------------------------------------------------------- the lay-in: this episode's join
// A lamination-shaped matte enters from one frame edge: a long strip whose leading end is cut at 45 degrees, its body covering the frame,
// so the mitre wipes the frame diagonally. It carries the incoming shot (the image slides with it) over `dur`, decelerating as a sheet
// settling onto a stack, and comes to rest (k mod 7) x `step` px in from its entry edge: the slivers of the sheets beneath form the
// joint's own stair along that edge; every seventh is flush and covers the stair, so the stair never holds more than 6 x step px, and it
// never holds words. crooked (0..1): the anarchy's join, seeded: off-step (0-60 px) and up to 1.5 degrees out of square.
// Returns { poly: [[x, y]...] (screen px), done (0..1), lift (px of shadow under its edge), rot (rad), off (px), k7, dx, dy (the image's
// slide) }. Pure in its arguments and t.
export const LAYIN = { W: 1080, H: 1920, step: 6 };
export function layInQuad({ edge = 'L', k = 0, t0 = 0, dur = 0.45, step = LAYIN.step, crooked = 0, seed = 1, W = LAYIN.W, H = LAYIN.H, offset = null } = {}, t = t0 + dur) {
  const u = clamp((t - t0) / dur), e = easeOut(u), k7 = ((k % 7) + 7) % 7;
  const r = mulberry((seed * 7919 + k * 104729) >>> 0);
  const off = offset != null ? offset : crooked > 0 ? Math.round(r() * 60 * crooked) : k7 * step;
  const rot = crooked > 0 ? (r() * 2 - 1) * 1.5 * crooked * Math.PI / 180 : 0;
  // in the strip's frame: a along the slide (from the entry edge), b across it
  const horiz = edge === 'L' || edge === 'R', A = horiz ? W : H, Bx = horiz ? H : W;
  const tipEnd = A + Bx + 12, tip = e * tipEnd, tail = off - (tipEnd - tip), slide = tip - tipEnd;
  const loc = [[tail, -4], [tip, -4], [tip - Bx - 8, Bx + 4], [tail, Bx + 4]];
  // to screen: L: a = x, b = y; R: a = W - x, b = H - y; T: a = y, b = W - x; B: a = H - y, b = x
  const toS = ([a, b]) => edge === 'L' ? [a, b] : edge === 'R' ? [W - a, H - b] : edge === 'T' ? [W - b, a] : [b, H - a];
  let poly = loc.map(toS);
  if (rot) { const cx = W / 2, cy = H / 2, c = Math.cos(rot), s = Math.sin(rot); poly = poly.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); }
  const dx = edge === 'L' ? slide : edge === 'R' ? -slide : 0, dy = edge === 'T' ? slide : edge === 'B' ? -slide : 0;
  const lift = 8 * (1 - sstep(0.55, 1, u)) + 1.2;
  return { poly, done: u, lift, rot, off, k7, edge, dx, dy };
}
// the area of a screen polygon inside the frame (px^2): the tests' coverage meter
export function frameCoverage(poly, W = LAYIN.W, H = LAYIN.H) {
  let p = poly.map(q => [q[0], q[1]]);
  p = clipHalf(p, -1, 0, 0); p = clipHalf(p, 1, 0, W); p = clipHalf(p, 0, -1, 0); p = clipHalf(p, 0, 1, H);
  return p.length >= 3 ? Math.abs(polyArea(p)) : 0;
}

// A card: a pressboard strip laid the same way, across the frame in its band (y, h), from the left or the right edge: its far end runs
// off-frame, its leading end is the mitre, which comes to rest partly inside the frame (the text stays clear of it). The card image is
// drawn at (x, y) and slides with the strip.
export function cardQuad({ edge = 'L', t0 = 0, dur = 0.42, y = 140, h = 360, crooked = 0, seed = 1, k = 0, W = LAYIN.W, reach = 0.6 } = {}, t = t0 + dur) {
  const u = clamp((t - t0) / dur), e = easeOut(u), r = mulberry((seed * 31 + k * 7 + 3) >>> 0);
  const rot = crooked > 0 ? (r() * 2 - 1) * 1.5 * crooked * Math.PI / 180 : 0, oy = crooked > 0 ? Math.round((r() * 2 - 1) * 24 * crooked) : 0;
  const travel = W + 2 * h + 120, d = (1 - e) * travel, top = y + oy, bot = top + h;
  let poly;
  if (edge === 'L') { const tipX = W + reach * h - d; poly = [[-80 - d, top], [tipX, top], [tipX - h, bot], [-80 - d, bot]]; }
  else { const tipX = -reach * h + d; poly = [[tipX, bot], [tipX + h, top], [W + 80 + d, top], [W + 80 + d, bot]]; }
  if (rot) { const cx = W / 2, cy = (top + bot) / 2, c = Math.cos(rot), s = Math.sin(rot); poly = poly.map(([px, py]) => [cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c]); }
  return { poly, done: u, lift: 6 * (1 - sstep(0.55, 1, u)) + 1.0, rot, dx: edge === 'L' ? -d : d, dy: oy, y: top, h, edge,
    clear: edge === 'L' ? W - (1 - reach) * h : (1 - reach) * h };          // the x the text must stay inside of (at the strip's far side)
}

// A stack of laid layers: [{ id, kind: 'shot' | 'card' | 'mark', t0, dur, edge, k, crooked, seed, until }] in laying order. at(t)
// returns the visible ones bottom to top with their mattes: every layer under the latest flush, square, settled sheet is covered and
// dropped, and no more than `keep` sheets are kept (older ones in a crooked heap are under at least that many others).
export class LayStack {
  constructor(layers, { keep = 12 } = {}) { this.layers = layers.slice().sort((a, b) => a.t0 - b.t0); this.keep = keep; }
  at(t) {
    const live = this.layers.filter(L => L.t0 <= t && (L.until == null || t < L.until));
    let base = 0, sheets = 0;
    for (let i = live.length - 1; i >= 0; i--) { const L = live[i]; if (L.kind === 'card') continue; const q = layInQuad(L, t); sheets++;
      if ((q.done >= 1 && q.off === 0 && !q.rot) || sheets >= this.keep) { base = i; break; } }
    return live.slice(base).map(L => ({ L, q: L.kind === 'card' ? cardQuad(L, t) : layInQuad(L, t) }));
  }
}

// draw one layer through its matte: img (canvas or image) drawn at `at` (its top-left at rest) under the clip, moved by the layer's
// slide (dx, dy) and rotation; the sheet's shadow on what is beneath it, `lift` px off; a hairline on its cut edge. ctx: a 2D context.
export function drawLayer(ctx, img, q, { at = [0, 0], size = null, shadow = 0.38, W = LAYIN.W, H = LAYIN.H, edgeLine = true } = {}) {
  if (!img || !q.poly || q.poly.length < 3) return;
  const path = () => { ctx.beginPath(); q.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  ctx.save(); ctx.translate(q.lift * 0.6, q.lift); path(); ctx.fillStyle = `rgba(0,0,0,${shadow})`; ctx.filter = `blur(${Math.max(1, q.lift * 0.8).toFixed(1)}px)`; ctx.fill(); ctx.restore();
  ctx.save(); path(); ctx.clip();
  const cx = q.y != null ? W / 2 : W / 2, cy = q.y != null ? q.y + q.h / 2 : H / 2;
  if (q.rot) { ctx.translate(cx, cy); ctx.rotate(q.rot); ctx.translate(-cx, -cy); }
  const w = size ? size[0] : (img.width || W), h = size ? size[1] : (img.height || H);
  ctx.drawImage(img, at[0] + (q.dx || 0), at[1] + (q.y != null ? 0 : (q.dy || 0)) + (q.y != null ? (q.dy || 0) * 0 : 0), w, h);
  ctx.restore();
  if (edgeLine) { ctx.save(); path(); ctx.strokeStyle = `rgba(232,233,232,${0.08 + 0.25 * (1 - q.done)})`; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
}
