// HAIR / v5 (HAIR5, round 5, 3 Oct; judge c10 step 1): what made hair the first CG read at 1:1, fixed from outside the older revs.
// Opt-in: groomHero({ rev: 5 }) (index.js) is the only caller; every older rev builds and renders exactly as before.
//   - the NAPE: lines and dark ribbons off the nape (L21, L17, L22) were short hairs (the hairline's vellus, the afro's shells, the coils)
//     thrown 10-15 cm sideways by field.js's push: below the skull it pushes radially to the body envelope, whose radius at the side of
//     the neck is the EAR's (head vertices below the eye) or the SHOULDER's (the arm's cap within 6 cm of the shoulder line), so a hair
//     point beside the neck went out to the ear's or the shoulder's radius and its card ran there as a straight line. pushNape: a short
//     layer's point is pushed out of the skull and the NECK alone (an envelope of neck and jaw vertices only) whenever the full push
//     would move it more than `cap`; long hair (manes over 15 cm, ropes, tails) keeps the full envelope, it rests on the shoulders.
//   - PARTINGS: the part a line of skin with hair falling away from it: roots kept out of a band a few millimetres either side of the part
//     plane (partOf: the style's own drape / part plane, over the top from the front hairline to before the crown), fine short hairs
//     along both edges lying away from it (layer 'part5'), and the scalp's dark root base opened along the line (shade.js SKIN_F5).
//   - CARDS that do not read as cards: CardBuilder5 narrows each card's root over its first `rootL` (a tuft from its follicles, not a
//     square end), shifts every periodic tile by a random phase along the hair (the cards no longer start on the same row of the tile),
//     uses the full tile across (so the shader knows where the card's edge is) and writes the distance from the root into the length of
//     the strand tangent (2 + 100 s; the shader takes it back without a new varying): shade.js FRAG5 starts each strand at its own
//     height in the first millimetres and drops strands near a card's long edges at random, so no quad edge or square end shows.
import * as THREE from 'three';
import { sstep, REG } from './field.js';
import { CardBuilder4, V, skinBlend, sampleRoots, arcLen } from './grow.js';
import { tileU, PERIODIC4, TILE, TILE4 } from './atlas.js';
import { registerLayer, cm, rr } from './styles.js';

// ---------------------------------------------------------------- the nape: a push that never throws short hair to the ear or shoulder
// the body near the neck as points with normals (neck, jaw, torso and the shoulder cap; not the head: the skull test covers it, and the
// ears are what threw hair sideways), on a 2 cm grid
function nearBody(F) {
  if (F._near5) return F._near5;
  const h = F.h, P = h.body.geometry.attributes.position.array, AH = h.aHero, NR = h.nrm, n = P.length / 3, cell = 0.02, grid = new Map(), y0 = F.shY - 0.12, y1 = F.eyeY;
  for (let v = 0; v < n; v++) { const r = AH[v * 4], y = P[v * 3 + 1]; if (y < y0 || y > y1) continue;
    if (!(r === REG.neck || r === REG.jaw || r === REG.torso || (r === REG.uarm && y > F.shY - 0.06))) continue;
    const k = `${Math.floor(P[v * 3] / cell)},${Math.floor(y / cell)},${Math.floor(P[v * 3 + 2] / cell)}`; let L = grid.get(k); if (!L) grid.set(k, (L = [])); L.push(v); }
  const near = (p, out) => { const a = Math.floor(p.x / cell), b = Math.floor(p.y / cell), c = Math.floor(p.z / cell); let best = -1, bd = 9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const L = grid.get(`${a + i},${b + j},${c + k}`); if (!L) continue;
      for (const v of L) { const d = (P[v * 3] - p.x) ** 2 + (P[v * 3 + 1] - p.y) ** 2 + (P[v * 3 + 2] - p.z) ** 2; if (d < bd) { bd = d; best = v; } } }
    if (best < 0) return false; out[0] = P[best * 3]; out[1] = P[best * 3 + 1]; out[2] = P[best * 3 + 2]; out[3] = NR[best * 3]; out[4] = NR[best * 3 + 1]; out[5] = NR[best * 3 + 2]; return true; };
  return (F._near5 = near);
}
// F.push for SHORT layers: out of the skull as before; below it, out of the body along the NEAREST body point's own normal (the minimal
// move, never more than 3 cm), not radially to the envelope's radius. A point the old push would have moved more than `cap` further
// is counted (F._nape5.caught: the points that became the lines off the nape).
export function napePush(F, push0, cap = 0.02) {
  const near = nearBody(F), q = V(), C = F.C, nb = [0, 0, 0, 0, 0, 0];
  const st = F._nape5 || (F._nape5 = { caught: 0, calls: 0 });
  return (p, off = 0.002) => {
    st.calls++; q.copy(p); push0(q, off);
    const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z, l = Math.hypot(dx, dy, dz);
    // the skull's radial push only where the skull is what lies under the point (above the chin line + 3 cm) and never more than 3 cm:
    // below it, toward the neck, the ray from the skull centre meets the jaw far out and threw nape cards 4-5 cm down and out (L22)
    if (l > 1e-6 && p.y > F.chinY + 0.03) { const r = F.rAt(dx / l, dy / l, dz / l); if (r > 0 && l < r + off) { const k = Math.min((r + off) / l, (l + 0.03) / l); p.set(C.x + dx * k, C.y + dy * k, C.z + dz * k); } }
    if (p.y < F.eyeY - 0.02 && near(p, nb)) { const s = (p.x - nb[0]) * nb[3] + (p.y - nb[1]) * nb[4] + (p.z - nb[2]) * nb[5];
      if (s < off) { const m = Math.min(0.03, off - s); p.x += nb[3] * m; p.y += nb[4] * m; p.z += nb[5] * m; } }
    if (q.distanceToSquared(p) > cap * cap) st.caught++;
    return p;
  };
}
// a layer is SHORT (its hair lies on the head and the neck) unless it is a rope, a tail, a bun, or loose hair longer than 15 cm
export function shortLayer(L) { if (['braids', 'locs3', 'tail', 'braid', 'bun', 'puff', 'roll', 'locs', 'cornrows'].includes(L.kind)) return false;
  const len = Array.isArray(L.len) ? Math.max(...L.len) : (L.len ?? 0); return !((L.kind === 'mane' || L.kind === 'frame' || L.kind === 'scalp' || L.kind === 'guides') && len > 15); }

// ---------------------------------------------------------------- partings
// the style's part plane (drape / part flows: a plane through the skull centre with normal (cos a, 0, -sin a), as v3.js flow3 and
// grow.js flowFn draw it), over the top of the head from the front hairline to before the crown
export function partOf(F, style, o = {}) {
  if (o === false) return null;
  const L = (style?.layers || []).find(l => (l.kind === 'mane' || l.kind === 'scalp') && l.flow && (l.flow.type === 'drape' || l.flow.type === 'part'));
  if (!L) return null;
  const pa = (L.flow.part ?? 0) * Math.PI / 180, m = V(Math.cos(pa), 0, -Math.sin(pa)), hw = cm(o.half ?? 0.16), C = F.C;
  const along = p => sstep(0.22, 0.5, (p.y - C.y) / F.ry) * sstep(-0.6, -0.25, (p.z - C.z) / F.rz);
  const dist = p => Math.abs((p.x - C.x) * m.x + (p.z - C.z) * m.z);
  return { m, hw, part: L.flow.part ?? 0, along, dist, flow: L.flow, strength: o.skin ?? 0.85,
    gap: p => 0.97 * sstep(hw * 1.35, hw * 0.55, dist(p)) * along(p) };
}
// roots out of the part band: a density wrapper (the hairline fn keeps its .dist / .extra / .line / .knots)
export function densWithPart(dens, part) {
  if (!part) return dens;
  const fn = (p, ph) => dens(p, ph) * (1 - part.gap(p));
  return Object.assign(fn, dens);
}
// fine short hairs along both edges of the part, lying away from it (the style's own flow there is across the part)
registerLayer('part5', (ctx, L, dens) => {
  const { F, B, rnd, o } = ctx, part = ctx.part5; if (!part || !dens) return;
  const band = cm(L.band ?? 0.45), hw = part.hw;
  const mask = p => { const d = part.dist(p); return part.along(p) * sstep(hw * 0.7, hw * 1.15, d) * sstep(hw + band, hw + band * 0.5, d); };
  const roots = sampleRoots(F, dens, Math.round((L.count ?? 260) * (o.density ?? 1)), rnd, { mask });
  const outF = p => p.clone().sub(F.C).normalize(); let made = 0;
  for (const sp of roots) {
    // away from the part, a little back (the comb of a drape at the part), lying on the scalp
    const q = sp.p.clone().sub(F.C), s = Math.sign(q.x * part.m.x + q.z * part.m.z) || 1, dir = part.m.clone().multiplyScalar(s).add(V(0, -0.15, -0.35)), n = sp.n;
    const t = dir.addScaledVector(n, -dir.dot(n)).normalize(), len = cm(rr(rnd, L.len ?? [0.6, 1.8])), m = 5, pts = [sp.p.clone().addScaledVector(n, 0.0003)];
    for (let k = 1; k <= m; k++) { const p = pts[k - 1].clone().addScaledVector(t, len / m).addScaledVector(n, 0.00025 * (k < 3 ? 1 : 0)); F.push(p, 0.0004 + 0.00025 * k); pts.push(p); t.addScaledVector(V(0, -1, 0), 0.08).normalize(); }
    const w = cm(0.12 + 0.1 * rnd());
    B.ribbon(pts, { tile: rnd() < 0.5 ? 'vellus' : 'sparse', ua: 0.1, ub: 0.9, w0: w, w1: w * 0.7, roll: (rnd() - 0.5) * 0.3, depth: 0.05, rand: rnd(), grey: ctx.greyBias(sp.p), out: outF, bend: 0.85, skin: p => skinBlend(F, sp, p), rootL: 0.002 });
    made++;
  }
  ctx.stats.push({ kind: 'part5', hairs: made });
});

// ---------------------------------------------------------------- cards that do not read as cards
// rootL (m): the root narrows over this length (to rootW of the width); periodic tiles: full width across, a random phase along;
// the strand tangent's length carries 2 + 100 s (s: metres from the root), read back by shade.js FRAG5
export class CardBuilder5 extends CardBuilder4 {
  constructor(o = {}) { super(o); this.rootL = o.rootL ?? 0.006; this.rootW = o.rootW ?? 0.6; }
  ribbon(pts, o) {
    const n = pts.length; if (n < 2) return;
    const tl = o.tile || 'straight', per = !!PERIODIC4[tl], slot = TILE[tl] ?? TILE4[tl] ?? 0;
    const rand = (slot + Math.min(0.999, Math.max(0, o.rand ?? 0))) / 16, vScale = o.vScale ?? (per ? this.vK * (o.w0 ?? 0.012) * (o.vK ?? 1) : null);
    const [u0, u1] = per ? tileU(tl, 0, 1) : tileU(tl, o.ua ?? 0, o.ub ?? 1), base = this.count, L = arcLen(pts), vOff = per ? (o.vOff ?? ((o.rand ?? 0) * 7.31 % 1)) : 0;
    const rootL = o.rootL ?? this.rootL, rootW = o.rootW ?? this.rootW;
    const cr = Math.cos(o.roll || 0), sr = Math.sin(o.roll || 0); let s = 0; this._sw = 0;
    for (let k = 0; k < n; k++) {
      if (k) s += pts[k].distanceTo(pts[k - 1]);
      const t = s / Math.max(L, 1e-6), d = (k < n - 1 ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1])).normalize();
      const out = o.out ? o.out(pts[k]) : pts[k].clone().sub(o.C).normalize();
      let side = o.sides ? o.sides[k].clone() : d.clone().cross(out); if (side.lengthSq() < 1e-10) side = d.clone().cross(V(0, 1, 0)); side.normalize();
      const up = d.clone().cross(side), sd = side.clone().multiplyScalar(cr).addScaledVector(up, sr), cn = d.clone().cross(sd).normalize(); if (cn.dot(out) < 0) cn.negate();
      const bn = out.clone().multiplyScalar(o.bend ?? 0.75).addScaledVector(cn, 1 - (o.bend ?? 0.75)).normalize();
      const rootK = rootL > 0 ? rootW + (1 - rootW) * sstep(0, rootL, s) : 1;
      const w = ((o.w0 ?? 0.012) + ((o.w1 ?? 0.004) - (o.w0 ?? 0.012)) * Math.pow(t, o.taper ?? 1.1)) / 2 * rootK;
      const [si, sw] = o.skin ? o.skin(pts[k]) : [[0, 0, 0, 0], [1, 0, 0, 0]], v = vScale ? s / vScale + vOff : t;
      const a = [t, o.depth ?? 0, rand, o.grey ?? 0], T = d.clone().multiplyScalar(2 + 100 * s);
      this._v(pts[k].clone().addScaledVector(sd, -w), bn, u0, v, T, a, si, sw, o.morph);
      this._v(pts[k].clone().addScaledVector(sd, w), bn, u1, v, T, a, si, sw, o.morph);
      if (k) { const i = base + 2 * (k - 1); this.IX.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    this.cards++;
  }
}

// ---------------------------------------------------------------- per form: the rev-5 shading (coily and curly hair is matte: its
// highlight is broken up by the curl, so the R lobe is broad and weak; card-to-card contrast low; the clump's normal softer)
export const FORM5 = {
  straight: { specR: 1.0, expR: 70, hLook: [0.12, 0.45, 0.35, 0.55], h4T: [0.32, 1.35, 0.8, 1.0] },
  wavy: { specR: 0.9, expR: 55, hLook: [0.12, 0.45, 0.35, 0.55], h4T: [0.32, 1.35, 0.8, 1.0] },
  curly: { specR: 0.6, expR: 30, hLook: [0.07, 0.35, 0.3, 0.45], h4T: [0.32, 1.45, 0.6, 0.55] },
  coily: { specR: 0.42, expR: 22, hLook: [0.05, 0.3, 0.25, 0.4], h4T: [0.32, 1.5, 0.55, 0.45] },
};
export const REV5 = { cap: 0.02, part: { half: 0.16, skin: 0.85 }, fringeCount: 760 };
