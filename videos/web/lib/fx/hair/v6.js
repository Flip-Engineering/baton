// HAIR / v6 (HAIR6, round 6, 4 Oct; the client: "improved hair physics / materials", "finer detail"): rev 6's own pieces, opt-in through
// groomHero({ rev: 6 }) (index.js); every older rev builds and renders exactly as before.
//   - hair6Key: the scalp material's deep-opacity term reads the key's shadow-map depth span (shade.js h6D.x); set per draw from the
//     scene's first shadow-casting directional light (the stages' key; lib/fx/light/rig.js: orthographic, near 1, far 6 x extent)
//   - FORM6M: per form, the rev-6 material's options over FORM5's (the lobe widths come from Cycles' roughness in shade.js)
import * as THREE from 'three';

export function hair6Key(mesh, mat) {
  const U = mat.userData.hairU; if (!U?.h6D) return;
  let scene0 = null, key = null; mesh.userData.h6Key = true;
  mesh.onBeforeRender = (renderer, scene) => {
    if (scene !== scene0 || !key || !key.parent) { scene0 = scene; key = null; scene.traverse(o => { if (!key && o.isDirectionalLight && o.castShadow && o.visible !== false) key = o; }); }
    if (key) { const c = key.shadow.camera; U.h6D.value.x = c.far - c.near; }
  };
}
// per form (over FORM5's): the volume's depth darkening and the root darkening relaxed where the deep opacity now carries the
// self-shadowing (rev 5: hLook.w 0.4-0.55, the curl atlas occlusion h4T.z 0.55-0.8)
// (judge c11: L08's parting a hard straight scalp stripe) the part's skin line narrower and weaker, more fine hairs along it
export const REV6 = { part: { half: 0.1, skin: 0.55 }, part5: { count: 480, band: 0.55 } };
export const FORM6M = {
  straight: { hLook: [0.12, 0.45, 0.35, 0.3], h4T: [0.32, 1.35, 0.55, 1.0] },
  wavy: { hLook: [0.12, 0.45, 0.35, 0.3], h4T: [0.32, 1.35, 0.55, 1.0] },
  curly: { hLook: [0.07, 0.35, 0.3, 0.25], h4T: [0.32, 1.45, 0.45, 0.55] },
  // (judge c11: L22's black coils read grey in the yard's sun) a coil masks its own highlight: the broad sheen weaker on coils
  coily: { hLook: [0.05, 0.3, 0.25, 0.22], h4T: [0.32, 1.5, 0.42, 0.45], specR6: 0.6, h6egain: 0.55 },
};

// ---------------------------------------------------------------- GEOMETRY at 1:1 (CardBuilder6, the scalp's builder under rev 6)
// HAIR5's curls and coils were flat cards carrying a ringlet / coil image (atlas4): at 1:1 they read as flakes, flat from every side.
// Under rev 6 a ringlet or coil card of the OUTER layers becomes thin STRIPS wound on a real helix round the card's centreline (the
// clump's axis): each strip a few millimetres wide (a lock of a few dozen strands of the straight strand tile), lying on the curl's
// cylinder (its width along the axis, its normal the curl's own radial, so a ringlet is lit as a round column), its radius ramping in
// from the root (hair leaves the follicle straight), radius, pitch, width and length varied per strip. The inner layer keeps its flat
// cards (the body of the hair: coverage behind the curls). Every other card's TIP narrows to a point over its last quarter (a lock
// thins to its last few strands: no square card ends, L03's fringe), and a card rooted within 1 cm of the hairline is split into three
// narrower, staggered ones (the hairline's tufts, L20). Counts and costs in the groom's report (report.parts.scalp.geo6).
import { CardBuilder5 } from './v5.js';
import { sstep } from './field.js';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const HELIX6 = {
  ringlet: { rK: 0.42, rMin: 0.0028, rMax: 0.0062, lamK: 5.5, K: 2, ppt: 7, ramp: 0.012, w: [0.0016, 0.0026], ub: 0.28, maxDepth: 0.3 },
  curlySparse: { rK: 0.42, rMin: 0.0028, rMax: 0.0062, lamK: 5.5, K: 2, ppt: 7, ramp: 0.012, w: [0.0014, 0.0024], ub: 0.24, maxDepth: 0.3 },
  coil4: { rK: 0.55, rMin: 0.0012, rMax: 0.0024, lamK: 3.4, K: 1, ppt: 6, ramp: 0.004, w: [0.0011, 0.0018], ub: 0.2, maxDepth: 1.01 },
  coilyFuzz: { rK: 0.3, rMin: 0.0012, rMax: 0.0026, lamK: 3.4, K: 1, ppt: 6, ramp: 0.004, w: [0.0012, 0.002], ub: 0.22, maxDepth: 0.4 },
};
export const HOLD6 = ['bun', 'puff', 'roll', 'pincurls', 'cornrows', 'wrap'];
export const GEO6 = { tip: 0.82, tipFrom: 0.72, lineCm: 1.0, lineSplit: 3, lineMinW: 0.0024 };
export class CardBuilder6 extends CardBuilder5 {
  constructor(o = {}) { super(o); this.g6 = { helix: true, tips: true, line: true, ...(o.geo6 || {}) }; this.rnd6 = o.rnd || Math.random; this.line6 = o.line || null; this.out6 = o.outF || null;
    this.st6 = { helixCards: 0, strips: 0, stripVerts: 0, split: 0, tips: 0 }; this.info6 = []; this.layer6 = null; }
  // per VERTEX: 1 = HELD (its layer gathers to a tie, or is a bun, a puff, a roll, pin curls, cornrows: the physics leaves it where the
  // style put it), 0 = free (sim6.js reads the mesh's userData.hold6)
  _v(p, n, u, v, t, a, si, sw, md) { super._v(p, n, u, v, t, a, si, sw, md); const L = this.layer6; this.info6.push(L && (L.gather || HOLD6.includes(L.kind)) ? 1 : 0); }
  _rec() {}
  ribbon(pts, o) {
    const tl = o.tile || 'straight', H = HELIX6[tl];
    if (this.g6.helix && H && (o.depth ?? 0) < H.maxDepth && pts.length >= 2) return this.helix6(pts, o, H);
    // the hairline: a card rooted within lineCm of the line, wide enough, split into narrower staggered ones (not vellus / part hairs)
    if (this.g6.line && this.line6 && !o._split6 && tl !== 'vellus' && tl !== 'fuzz' && (o.w0 ?? 0.012) > GEO6.lineMinW && pts.length >= 2) { const e = this.line6(pts[0]);
      if (e != null && e < GEO6.lineCm / 100 && e > -0.004) return this.split6(pts, o); }
    const base = this.count; if (pts.length >= 2) this._rec(); super.ribbon(pts, o); if (this.g6.tips && tl !== 'vellus') this.tip6(base);
  }
  // the last quarter of a card narrows to GEO6.tip of its width (towards its own centreline)
  tip6(base) { const n = (this.count - base) / 2, P = this.P, A = this.A; if (n < 2) return; let any = false;
    for (let k = 0; k < n; k++) { const a = base + 2 * k, b = a + 1, t = A[a * 4], f = 1 - GEO6.tip * sstep(GEO6.tipFrom, 1, t); if (f >= 0.999) continue; any = true;
      for (let j = 0; j < 3; j++) { const m = 0.5 * (P[a * 3 + j] + P[b * 3 + j]); P[a * 3 + j] = m + (P[a * 3 + j] - m) * f; P[b * 3 + j] = m + (P[b * 3 + j] - m) * f; } }
    if (any) this.st6.tips++; }
  split6(pts, o) { const r = this.rnd6, n = GEO6.lineSplit, w = (o.w0 ?? 0.012), d0 = pts[1].clone().sub(pts[0]).normalize(), out = (o.out ? o.out(pts[0]) : pts[0].clone().sub(o.C).normalize()), side = d0.clone().cross(out).normalize();
    for (let j = 0; j < n; j++) { const off = (j - (n - 1) / 2) * w / n * (0.8 + 0.4 * r()), keep = Math.max(2, Math.round(pts.length * (0.55 + 0.45 * r()))), q = pts.slice(0, keep).map(p => p.clone().addScaledVector(side, off));
      this.ribbon(q, { ...o, _split6: true, w0: w / n * (0.8 + 0.4 * r()), w1: (o.w1 ?? 0.004) / n, rand: r() }); }
    this.st6.split++; }
  // K strips on a helix round the card's centreline
  helix6(pts, o, H) {
    const r = this.rnd6; let L = 0; const S = [0]; for (let k = 1; k < pts.length; k++) { L += pts[k].distanceTo(pts[k - 1]); S.push(L); }
    if (L < 0.008) { const base = this.count; this._rec(); super.ribbon(pts, o); this.tip6(base); return; }
    const r0 = Math.min(H.rMax, Math.max(H.rMin, (o.w0 ?? 0.01) * H.rK)), lam = r0 * H.lamK * (0.85 + 0.3 * r()), ds = lam / H.ppt, ns = Math.max(3, Math.ceil(L / ds) + 1);
    // the axis resampled at ds, with a parallel-transported frame (e1, e2) round it
    const A = [], D = []; let j = 0;
    for (let k = 0; k < ns; k++) { const s = Math.min(L, k * ds); while (j < S.length - 2 && S[j + 1] < s) j++; const f = (s - S[j]) / Math.max(1e-9, S[j + 1] - S[j]); A.push(pts[j].clone().lerp(pts[j + 1], Math.min(1, Math.max(0, f)))); }
    for (let k = 0; k < ns; k++) D.push((k < ns - 1 ? A[k + 1].clone().sub(A[k]) : A[k].clone().sub(A[k - 1])).normalize());
    const out0 = o.out ? o.out(A[0]) : A[0].clone().sub(o.C).normalize(); let e1 = out0.clone().addScaledVector(D[0], -out0.dot(D[0])); if (e1.lengthSq() < 1e-8) e1 = V(1, 0, 0).cross(D[0]); e1.normalize();
    const E1 = [], E2 = []; for (let k = 0; k < ns; k++) { if (k) { e1.addScaledVector(D[k], -e1.dot(D[k])); if (e1.lengthSq() < 1e-10) e1 = V(0, 1, 0).cross(D[k]); e1.normalize(); } E1.push(e1.clone()); E2.push(D[k].clone().cross(e1)); }
    const hand = r() < 0.5 ? 1 : -1, ph0 = r() * Math.PI * 2;
    for (let q = 0; q < H.K; q++) {
      const rq = r0 * (0.8 + 0.35 * r()), phq = ph0 + q * 2 * Math.PI / H.K + (r() - 0.5) * 0.6, wq = H.w[0] + (H.w[1] - H.w[0]) * r(), endK = Math.max(3, Math.round(ns * (0.82 + 0.18 * r())));
      const P = [], SD = [], OUT = new Map();
      for (let k = 0; k < endK; k++) { const s = k * ds, a = rq * sstep(0, H.ramp, s), th = phq + hand * s / lam * 2 * Math.PI, c = Math.cos(th), sn = Math.sin(th);
        const rad = E1[k].clone().multiplyScalar(c).addScaledVector(E2[k], sn), p = A[k].clone().addScaledVector(rad, a);
        // the helix's tangent, and the strip's width along the axis projected off it (the strip lies on the curl's cylinder)
        const tan = D[k].clone().addScaledVector(E1[k].clone().multiplyScalar(-sn).addScaledVector(E2[k], c), hand * a * 2 * Math.PI / lam).normalize();
        const sd = D[k].clone().addScaledVector(tan, -D[k].dot(tan)); if (sd.lengthSq() < 1e-10) sd.copy(rad.clone().cross(tan)); sd.normalize();
        const ov = o.out ? o.out(A[k]) : out0, nn = rad.clone().multiplyScalar(a > 1e-5 ? 0.55 : 0).addScaledVector(ov, a > 1e-5 ? 0.45 : 1).normalize();
        P.push(p); SD.push(sd); OUT.set(p, nn); }
      if (P.length < 2) continue;
      const ua = r() * (1 - H.ub);
      this._rec(); super.ribbon(P, { ...o, tile: 'straight', ua, ub: ua + H.ub, w0: wq, w1: wq * 0.45, taper: 1.4, roll: 0, sides: SD, out: p => OUT.get(p) || out0, bend: 0.5, rootL: 0.002, rand: 0.9 + 0.0999 * r() });   // (the random in [0.9, 1): person_hair.py's strip tag)
      this.st6.strips++; this.st6.stripVerts += P.length * 2;
    }
    this.st6.helixCards++;
  }
}
