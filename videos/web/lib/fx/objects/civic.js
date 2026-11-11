// CIVIC BUILDING (OBJECTS c1): an American county courthouse, built by a split grammar, not "a building".
//
// Reference: HABS county-courthouse surveys (Library of Congress HABS/HAER/HALS: Greek Revival and Beaux-Arts county seats of
// the Midwest and South, 1840-1920), Asher Benjamin's The American Builder's Companion (1827) for the orders, Müller et al.
// "Procedural Modeling of Buildings" (SIGGRAPH 2006) for the split grammar: massing -> storeys -> bays -> window.
// Harvested from scenes/allpower.js (the ALL POWER courthouse: seven risers, six fluted columns, the pediment, 6-over-6
// sashes, the clock stage at 2:00, the verdigris cupola), rebuilt here as real geometry so raking light can find it:
// recessed windows with architraves, sills, hoods and muntins; quoins; a dentil cornice; a balustrade; the order's
// capitals; the frieze inscription; the steps; the clock drum and the cupola or dome.
//
//   civic({ seed, order: 'doric'|'ionic'|'corinthian', cols: 4|6, storeys: 2|3, bays: 7, wings: true, stone: 'lime'|'brick'|'red',
//           top: 'cupola'|'dome'|'clock'|'none', inscription: 'COURT HOUSE', clock: [2, 0], lit: 0..1 })
// Faces +z; centre x = 0; ground y = 0; metres. meta.anchors: pediment, clock, door, steps, cornice; meta.lights: door, windows.
import * as THREE from 'three';
import { G, Parts, V3, TAU, rng, pick, range, mat, fin, paint, canvasTex, finish } from './kit.js';

const STONES = {
  lime:  { color: 0xc9bea6, joints: { h: 0.62, l: 1.25, w: 0.014, k: 0.55, color: [0.42, 0.38, 0.31] } },
  grey:  { color: 0xa8a69c, joints: { h: 0.55, l: 1.1, w: 0.014, k: 0.55, color: [0.34, 0.33, 0.3] } },
  brick: { color: 0x8a4430, joints: { h: 0.075, l: 0.225, w: 0.008, k: 0.7, color: [0.78, 0.74, 0.66] } },
  red:   { color: 0x7a3a2a, joints: { h: 0.62, l: 1.25, w: 0.014, k: 0.45, color: [0.3, 0.18, 0.14] } },   // red sandstone
};

function inscriptionTex(text, stone) {
  return canvasTex(1024, 96, (g, w, h) => {
    g.fillStyle = '#' + new THREE.Color(stone).getHexString(); g.fillRect(0, 0, w, h);
    g.font = '400 64px Cinzel, "Trajan Pro", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const t = text.split('').join(String.fromCharCode(8202));
    g.fillStyle = 'rgba(255,250,235,0.35)'; g.fillText(t, w / 2 + 1.5, h / 2 + 2);   // the cut's lit lower lip
    g.fillStyle = 'rgba(40,34,26,0.85)'; g.fillText(t, w / 2, h / 2);
  });
}
function clockTex(hh = 2, mm = 0) {
  return canvasTex(512, 512, (g, w) => {
    const c = w / 2; g.fillStyle = '#20180f'; g.fillRect(0, 0, w, w);
    const gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, '#fff4d8'); gr.addColorStop(0.85, '#f0d9a6'); gr.addColorStop(0.87, '#2a2016'); gr.addColorStop(1, '#2a2016');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, c - 4, 0, TAU); g.fill();
    g.fillStyle = '#1a140c'; g.font = '700 46px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU - Math.PI / 2; g.save(); g.translate(c + Math.cos(a) * c * 0.68, c + Math.sin(a) * c * 0.68); g.rotate(a + Math.PI / 2); g.fillText(R[i], 0, 0); g.restore(); }
    for (let i = 0; i < 60; i++) { const a = i / 60 * TAU; g.fillRect(c + Math.cos(a) * c * 0.8 - 2, c + Math.sin(a) * c * 0.8 - 2, i % 5 ? 3 : 7, i % 5 ? 3 : 7); }
    const hand = (a, L, wd) => { g.save(); g.translate(c, c); g.rotate(a); g.fillRect(-wd / 2, -L, wd, L + 20); g.restore(); };
    hand((hh % 12 + mm / 60) / 12 * TAU, c * 0.45, 16); hand(mm / 60 * TAU, c * 0.66, 10);
    g.beginPath(); g.arc(c, c, 14, 0, TAU); g.fill();
  });
}

// a fluted column with entasis, base (torus + plinth) and a capital of the order; y from 0 to h, radius r at the foot
function column(order, r, h, seg = 24) {
  const out = [];
  const shaft = new THREE.CylinderGeometry(r * 0.84, r, h, seg * 2, 8), P = shaft.attributes.position;
  for (let k = 0; k < P.count; k++) {
    const y = P.getY(k) / h + 0.5, a = Math.atan2(P.getZ(k), P.getX(k));
    const ent = 1 + 0.035 * Math.sin(Math.min(1, y * 1.5) * Math.PI) * (y < 0.66 ? 1 : 0.6);
    const flute = order === 'doric' ? 1 - 0.045 * Math.abs(Math.sin(a * 10)) : 1 - 0.05 * (0.5 + 0.5 * Math.cos(a * 24));
    P.setX(k, P.getX(k) * ent * flute); P.setZ(k, P.getZ(k) * ent * flute);
  }
  shaft.computeVertexNormals(); out.push(shaft.translate(0, h / 2, 0));
  if (order !== 'doric') out.push(G.box(r * 2.5, r * 0.35, r * 2.5, 0, -r * 0.35, 0), G.lathe([[0, 0], [r * 1.18, 0], [r * 1.22, r * 0.1], [r * 1.1, r * 0.2], [r * 1.02, r * 0.25], [r * 1.08, r * 0.32], [r, r * 0.4], [0, r * 0.4]], seg).translate(0, -r * 0.2, 0));
  const top = h, ra = r * 0.84;
  if (order === 'doric') {
    out.push(G.lathe([[0, 0], [ra, 0], [ra * 1.02, r * 0.08], [ra * 1.3, r * 0.3], [ra * 1.38, r * 0.42], [0, r * 0.42]], seg).translate(0, top, 0));
    out.push(G.box(ra * 2.9, r * 0.28, ra * 2.9, 0, top + r * 0.56, 0));
  } else if (order === 'ionic') {
    out.push(G.lathe([[0, 0], [ra * 1.05, 0], [ra * 1.2, r * 0.18], [0, r * 0.18]], seg).translate(0, top, 0));
    out.push(G.box(ra * 2.6, r * 0.16, ra * 1.8, 0, top + r * 0.27, 0));
    for (const s of [-1, 1]) { out.push(new THREE.TorusGeometry(r * 0.28, r * 0.11, 8, 18).translate(s * ra * 1.15, top + r * 0.06, ra * 0.55), new THREE.TorusGeometry(r * 0.28, r * 0.11, 8, 18).translate(s * ra * 1.15, top + r * 0.06, -ra * 0.55), G.cylZ(r * 0.3, ra * 1.1, s * ra * 1.15, top + r * 0.06, 0, 14)); }
    out.push(G.box(ra * 2.8, r * 0.12, ra * 2.8, 0, top + r * 0.41, 0));
  } else {
    // corinthian: a bell with two rings of acanthus (lobes) and corner volutes under a concave abacus
    out.push(G.lathe([[0, 0], [ra, 0], [ra * 1.05, r * 0.5], [ra * 1.3, r * 1.0], [ra * 1.45, r * 1.15], [0, r * 1.15]], seg).translate(0, top, 0));
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 8; i++) { const a = (i + ring * 0.5) / 8 * TAU; out.push(new THREE.SphereGeometry(r * 0.24, 8, 6).scale(0.7, 1.5, 0.6).rotateY(-a).translate(Math.cos(a) * ra * (1.02 + ring * 0.12), top + r * (0.3 + ring * 0.38), Math.sin(a) * ra * (1.02 + ring * 0.12))); }
    for (let i = 0; i < 4; i++) { const a = (i + 0.5) / 4 * TAU; out.push(new THREE.TorusGeometry(r * 0.16, r * 0.06, 6, 12).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * ra * 1.45, top + r * 1.0, Math.sin(a) * ra * 1.45)); }
    out.push(G.box(ra * 3.0, r * 0.18, ra * 3.0, 0, top + r * 1.25, 0));
  }
  return out;
}
// a window bay: architrave surround, recessed dark glass, sashes with muntins (6-over-6 or 2-over-2), sill, hood
function windowBay(P, x, y, z, w, h, { muntins = [3, 2], hood = 'flat', depth = 0.25, facing = 1, lit = false, axis = 'z' } = {}) {
  const f = facing, put = g => (axis === 'x' ? g.rotateY(Math.PI / 2 * f) : f < 0 ? g.rotateY(Math.PI) : g).translate(x, y, z);
  const t = 0.16, d = 0.08;
  P.add('trim', put(G.box(w + 2 * t, t, d, 0, h / 2 + t / 2, d / 2)), put(G.box(t, h, d, -w / 2 - t / 2, 0, d / 2)), put(G.box(t, h, d, w / 2 + t / 2, 0, d / 2)));
  P.add('trim', put(G.box(w + 2 * t + 0.2, 0.1, 0.22, 0, -h / 2 - 0.05, 0.1)), put(G.box(w + 2 * t + 0.1, 0.06, 0.12, 0, -h / 2 - 0.13, 0.05)));
  P.add('reveal', put(G.box(w, h, 0.02, 0, 0, -depth)));
  P.add('reveal', put(G.box(0.02, h, depth, -w / 2, 0, -depth / 2)), put(G.box(0.02, h, depth, w / 2, 0, -depth / 2)), put(G.box(w, 0.02, depth, 0, h / 2, -depth / 2)));
  P.add(lit ? 'glassLit' : 'glass', put(G.box(w - 0.04, h - 0.04, 0.01, 0, 0, -depth + 0.03)));
  const [nx, ny] = muntins, fz = -depth + 0.06;
  P.add('sash', put(G.box(w, 0.07, 0.05, 0, 0, fz)));                         // meeting rail
  P.add('sash', put(G.box(w, 0.05, 0.04, 0, h / 2 - 0.03, fz)), put(G.box(w, 0.05, 0.04, 0, -h / 2 + 0.03, fz)), put(G.box(0.05, h, 0.04, -w / 2 + 0.025, 0, fz)), put(G.box(0.05, h, 0.04, w / 2 - 0.025, 0, fz)));
  for (let i = 1; i < nx; i++) P.add('sash', put(G.box(0.025, h, 0.03, -w / 2 + i * w / nx, 0, fz)));
  for (const half of [-1, 1]) for (let j = 1; j < ny; j++) P.add('sash', put(G.box(w, 0.025, 0.03, 0, half * (h / 4) + (j - ny / 2) * (h / 2 / ny) * 1, fz)));
  if (hood === 'pediment') P.add('trim', put(G.extrude([[-w / 2 - 0.35, 0], [w / 2 + 0.35, 0], [0, 0.42]], 0.18).translate(0, h / 2 + t + 0.02, 0.1)), put(G.box(w + 0.7, 0.1, 0.22, 0, h / 2 + t + 0.02, 0.1)));
  else if (hood === 'cornice') P.add('trim', put(G.box(w + 0.6, 0.14, 0.26, 0, h / 2 + t + 0.08, 0.12)), put(G.box(w + 0.4, 0.2, 0.12, 0, h / 2 + t - 0.05, 0.06)));
  else if (hood === 'keystone') P.add('trim', put(G.extrude([[-0.14, 0], [0.14, 0], [0.19, 0.36], [-0.19, 0.36]], 0.14).translate(0, h / 2 + 0.02, 0.1)));
}

export function civic(o = {}) {
  const r = rng(o.seed ?? 1);
  const order = o.order ?? pick(r, ['doric', 'ionic', 'ionic', 'corinthian']);
  const cols = o.cols ?? pick(r, [4, 6, 6]);
  const storeys = o.storeys ?? pick(r, [2, 2, 3]);
  const stoneK = o.stone ?? pick(r, ['lime', 'lime', 'grey', 'brick', 'red']);
  const top = o.top ?? pick(r, ['cupola', 'cupola', 'dome', 'clock', 'none']);
  const wings = o.wings ?? (r() < 0.7);
  const bays = o.bays ?? (cols === 4 ? 5 : 7);
  const stH = 4.4, plinth = 1.5, bayW = 3.2;
  const W = bays * bayW + 2.4, D = o.depth ?? 22, H = plinth + storeys * stH;
  const st = STONES[stoneK], brick = stoneK === 'brick';
  const P = new Parts(), anchors = {}, lights = [];
  const zf = D / 2;
  // ---- massing: rusticated plinth (deep horizontal channels), the block, the wings
  P.add('plinth', G.box(W + 0.4, plinth, D + 0.4, 0, plinth / 2, 0));
  for (let y = 0.35; y < plinth; y += 0.38) P.add('reveal', G.box(W + 0.42, 0.05, 0.02, 0, y, zf + 0.2), G.box(0.02, 0.05, D + 0.42, W / 2 + 0.2, y, 0), G.box(0.02, 0.05, D + 0.42, -W / 2 - 0.2, y, 0));
  P.add('wall', G.box(W, H - plinth, D, 0, (H + plinth) / 2, 0));
  // quoins: alternating long and short blocks at every corner, proud of the wall
  for (const sx of [-1, 1]) for (let y = plinth, k = 0; y < H - 0.5; y += 0.62, k++) { const L = k % 2 ? 0.7 : 1.1; P.add('trim', G.box(L, 0.56, 0.08, sx * (W / 2 - L / 2 + 0.02), y + 0.31, zf + 0.04), G.box(0.08, 0.56, L, sx * (W / 2 + 0.04), y + 0.31, zf - L / 2 + 0.02)); }
  // string courses between storeys; the cornice with dentils and modillions; a balustrade on the parapet
  for (let s = 1; s < storeys; s++) P.add('trim', G.box(W + 0.3, 0.3, D + 0.3, 0, plinth + s * stH, 0));
  P.add('trim', G.box(W + 0.3, 0.3, D + 0.3, 0, plinth + 0.15, 0));
  P.add('trim', G.box(W + 0.2, 0.9, D + 0.2, 0, H + 0.45, 0), G.box(W + 1.2, 0.35, D + 1.2, 0, H + 1.08, 0), G.box(W + 0.9, 0.18, D + 0.9, 0, H + 0.83, 0));
  for (let x = -W / 2 - 0.35; x <= W / 2 + 0.35; x += 0.32) P.add('trim', G.box(0.16, 0.2, 0.18, x, H + 0.72, zf + 0.5));
  for (let z = -D / 2 - 0.35; z <= D / 2 + 0.35; z += 0.32) for (const sx of [-1, 1]) P.add('trim', G.box(0.18, 0.2, 0.16, sx * (W / 2 + 0.5), H + 0.72, z));
  const bal = [];
  const baluster = G.lathe([[0, 0], [0.12, 0], [0.12, 0.08], [0.07, 0.14], [0.13, 0.35], [0.06, 0.55], [0.08, 0.62], [0.11, 0.66], [0, 0.66]], 8);
  const addBal = (x0, x1, z) => { P.add('trim', G.box(x1 - x0, 0.14, 0.4, (x0 + x1) / 2, H + 1.3, z), G.box(x1 - x0 + 0.1, 0.16, 0.46, (x0 + x1) / 2, H + 2.05, z)); for (let x = x0 + 0.25; x < x1 - 0.1; x += 0.36) P.add('trim', baluster.clone().translate(x, H + 1.37, z)); for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 4) P.add('trim', G.box(0.4, 0.8, 0.44, x, H + 1.65, z)); };
  if (o.balustrade ?? !brick) addBal(-W / 2, W / 2, zf);
  // ---- windows: storey x bay; the piano nobile gets pediment hoods, the upper storey plain, the ground keystones
  const portW = cols === 6 ? 5 * 4.6 + 2 : 3 * 4.6 + 2;
  for (let s = 0; s < storeys; s++) {
    const y = plinth + s * stH + stH * 0.52, h = s === storeys - 1 && storeys > 2 ? 2.4 : 3.2, w = 1.5;
    const hood = s === 0 ? (storeys > 2 ? 'keystone' : 'cornice') : s === 1 && storeys > 2 ? 'pediment' : 'cornice';
    for (let i = 0; i < bays; i++) {
      const x = -W / 2 + 1.2 + bayW / 2 + i * bayW;
      if (s === 0 && Math.abs(x) < bayW * 0.6) continue;       // the door bay
      windowBay(P, x, y, zf, w, h, { hood, muntins: brick ? [2, 1] : [3, 2], lit: (o.litWindows ?? []).includes(s * 100 + i) });
    }
    for (let i = 0; i < Math.floor(D / bayW) - 1; i++) for (const sx of [-1, 1]) windowBay(P, sx * W / 2, y, -D / 2 + bayW + i * bayW, w, h, { hood, axis: 'x', facing: sx, muntins: brick ? [2, 1] : [3, 2] });
  }
  // ---- the door: tall panelled double doors, a lit transom, a surround with a cornice
  const doorH = 4.0;
  P.add('trim', G.box(3.4, doorH + 1.3, 0.12, 0, plinth + (doorH + 1.3) / 2, zf + 0.06), G.box(4.0, 0.3, 0.4, 0, plinth + doorH + 1.45, zf + 0.2));
  P.add('door', G.box(2.4, doorH - 0.1, 0.1, 0, plinth + (doorH - 0.1) / 2, zf - 0.2));
  for (const sx of [-1, 1]) for (const yy of [0.9, 2.5]) P.add('doorP', G.box(0.8, 1.2, 0.04, sx * 0.6, plinth + yy, zf - 0.13));
  P.add('transom', G.box(2.4, 0.8, 0.05, 0, plinth + doorH + 0.5, zf - 0.2));
  anchors.door = V3(0, plinth + doorH / 2, zf); lights.push({ kind: 'door', pos: V3(0, plinth + doorH + 0.5, zf), color: 0xffb060 });
  // ---- wings: lower blocks set back, their own cornice and windows
  if (wings) for (const sx of [-1, 1]) {
    const ww = 3 * bayW + 1.2, wh = plinth + stH * (storeys > 2 ? 2 : 1) + 0.6, wx = sx * (W / 2 + ww / 2 - 0.2), wd = D * 0.8;
    P.add('plinth', G.box(ww, plinth, wd + 0.3, wx, plinth / 2, -D * 0.05));
    P.add('wall', G.box(ww, wh - plinth, wd, wx, (wh + plinth) / 2, -D * 0.05));
    P.add('trim', G.box(ww + 0.5, 0.5, wd + 0.5, wx, wh + 0.25, -D * 0.05), G.box(ww + 0.9, 0.25, wd + 0.9, wx, wh + 0.6, -D * 0.05));
    for (let s = 0; s < (storeys > 2 ? 2 : 1); s++) for (let i = 0; i < 3; i++) windowBay(P, wx - ww / 2 + 0.6 + bayW / 2 + i * bayW, plinth + s * stH + stH * 0.52, -D * 0.05 + wd / 2, 1.4, 3.0, { hood: 'cornice', muntins: brick ? [2, 1] : [3, 2] });
  }
  // ---- the portico: steps, stylobate, columns, entablature (architrave fasciae, frieze, dentil cornice), pediment
  const colR = cols === 6 ? 0.7 : 0.75, colH = storeys * stH - 1.4, pz = zf + 3.0, span = (cols - 1) * 4.6;
  const nSteps = 7;
  for (let s = 0; s < nSteps; s++) P.add('step', G.box(portW + 2.4 - s * 0.3, plinth / nSteps, 7.0 - s * 0.55, 0, (s + 0.5) * plinth / nSteps, pz + 1.6 - s * 0.27));
  for (const sx of [-1, 1]) P.add('plinth', G.box(1.1, plinth + 0.6, 7.2, sx * (portW / 2 + 1.25), (plinth + 0.6) / 2, pz + 1.5));     // cheek walls
  P.add('step', G.box(portW + 0.6, 0.3, 5.2, 0, plinth + 0.15, pz - 0.6));
  for (let i = 0; i < cols; i++) { const cx = -span / 2 + i * 4.6; for (const g of column(order, colR, colH)) P.add('col', g.translate(cx, plinth + 0.3 + (order === 'doric' ? 0 : colR * 0.35), pz)); }
  const capH = order === 'corinthian' ? colR * 1.35 : order === 'ionic' ? colR * 0.5 : colR * 0.7;
  const eY = plinth + 0.3 + colH + capH + (order === 'doric' ? 0 : colR * 0.35);
  const eW = span + colR * 3.4, eD = 5.8;
  P.add('trim', G.box(eW, 0.45, eD, 0, eY + 0.22, pz - 2.4), G.box(eW + 0.1, 0.35, eD + 0.1, 0, eY + 0.62, pz - 2.4));   // architrave (two fasciae)
  P.add('frieze', G.box(eW, 1.1, eD, 0, eY + 1.35, pz - 2.4));
  if (order === 'doric') for (let x = -eW / 2 + 0.4; x < eW / 2; x += 1.15) { P.add('trim', G.box(0.6, 1.08, 0.08, x, eY + 1.35, pz - 2.4 + eD / 2 + 0.04)); for (const d of [-0.15, 0.15]) P.add('reveal', G.box(0.06, 0.9, 0.02, x + d, eY + 1.38, pz - 2.4 + eD / 2 + 0.085)); }
  P.add('trim', G.box(eW + 0.6, 0.5, eD + 0.6, 0, eY + 2.15, pz - 2.4));
  for (let x = -eW / 2 - 0.2; x <= eW / 2 + 0.2; x += 0.3) P.add('trim', G.box(0.15, 0.18, 0.16, x, eY + 1.99, pz - 2.4 + eD / 2 + 0.34));
  const ins = o.inscription ?? 'COURT HOUSE';
  P.add('inscr', new THREE.PlaneGeometry(eW * 0.8, 0.8).translate(0, eY + 1.35, pz - 2.4 + eD / 2 + 0.012));
  // pediment: the tympanum set back, raking cornices, acroteria
  const pH = eW * 0.14, pY = eY + 2.4;
  P.add('wall', G.extrude([[-eW / 2 - 0.2, 0], [eW / 2 + 0.2, 0], [0, pH]], eD - 0.6).translate(0, pY, pz - 2.7));
  P.add('tymp', G.extrude([[-eW / 2 + 0.6, 0.25], [eW / 2 - 0.6, 0.25], [0, pH - 0.45]], 0.1).translate(0, pY, pz - 2.4 + eD / 2 - 0.25));
  const rake = Math.atan2(pH, eW / 2 + 0.2), rl = Math.hypot(pH, eW / 2 + 0.2);
  for (const sx of [-1, 1]) { P.add('trim', G.box(rl + 0.5, 0.42, eD + 0.9, 0, 0, 0).rotateZ(-sx * rake).translate(sx * (eW / 4 + 0.1), pY + pH / 2 + 0.2, pz - 2.4)); P.add('trim', G.box(0.7, 0.6, 0.7, sx * (eW / 2 + 0.2), pY + 0.3, pz - 2.4 + eD / 2)); }
  P.add('trim', G.box(0.8, 0.8, 0.8, 0, pY + pH + 0.4, pz - 2.4 + eD / 2 - 0.2));
  // a round oculus in the tympanum (a wreath or the clock there when there is no tower)
  if (top === 'none' || top === 'clock') P.add('trim', new THREE.TorusGeometry(1.0, 0.16, 8, 32).translate(0, pY + pH * 0.42, pz - 2.4 + eD / 2 - 0.1));
  anchors.pediment = V3(0, pY + pH * 0.5, pz + 0.5); anchors.cornice = V3(0, eY + 2.2, pz + 0.5); anchors.steps = V3(0, 0.2, pz + 4.5);
  // the portico ceiling (coffers read as dark squares from below) and the roof over the portico
  P.add('reveal', G.box(eW - 0.4, 0.1, eD - 0.4, 0, eY - 0.02, pz - 2.4));
  // ---- the roof and the top: a low hipped roof, then the clock drum + cupola, or a dome on a colonnaded drum
  P.add('roof', G.extrude([[-W / 2 - 0.2, 0], [W / 2 + 0.2, 0], [W / 2 - 3, 2.5], [-W / 2 + 3, 2.5]], D - 1).translate(0, H + 1.2, 0));
  const cx0 = 0, cz0 = -1.0, tb = H + 3.6;
  if (top === 'cupola' || top === 'clock') {
    P.add('wall', G.box(8.4, 2.2, 8.4, cx0, tb - 0.5, cz0), G.box(7.2, 5.6, 7.2, cx0, tb + 3.2, cz0));
    P.add('trim', G.box(8.8, 0.35, 8.8, cx0, tb + 0.6, cz0), G.box(7.8, 0.5, 7.8, cx0, tb + 6.2, cz0), G.box(8.2, 0.25, 8.2, cx0, tb + 6.55, cz0));
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; P.add('trim', G.box(1.0, 5.6, 1.0, cx0 + Math.cos(a + TAU / 8) * 3.9, tb + 3.2, cz0 + Math.sin(a + TAU / 8) * 3.9)); }
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; const f = new THREE.CircleGeometry(2.05, 40).rotateY(-a + Math.PI / 2).translate(cx0 + Math.cos(a) * 3.62, tb + 3.3, cz0 + Math.sin(a) * 3.62); P.add('clock', f); P.add('trim', new THREE.TorusGeometry(2.15, 0.14, 8, 40).rotateY(-a + Math.PI / 2).translate(cx0 + Math.cos(a) * 3.64, tb + 3.3, cz0 + Math.sin(a) * 3.64)); }
    anchors.clock = V3(cx0, tb + 3.3, cz0 + 3.62); lights.push({ kind: 'clock', pos: anchors.clock.clone(), color: 0xffe8b8 });
    if (top === 'cupola') {
      // the belfry: an octagon of eight posts with arched openings, then the ogee cupola and a finial
      const bY = tb + 6.7;
      P.add('trim', G.cyl(3.6, 3.6, 0.3, cx0, bY + 0.15, cz0, 8));
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; P.add('trim', G.box(0.55, 3.2, 0.55, cx0 + Math.cos(a) * 3.1, bY + 1.9, cz0 + Math.sin(a) * 3.1)); }
      P.add('reveal', G.cyl(2.6, 2.6, 3.0, cx0, bY + 1.8, cz0, 8));
      P.add('trim', G.cyl(3.5, 3.5, 0.45, cx0, bY + 3.7, cz0, 8));
      P.add('copper', G.lathe([[3.4, 0], [3.2, 0.6], [2.4, 1.6], [1.2, 2.5], [0.5, 3.4], [0.4, 3.9], [0.0, 4.0]], 8).translate(cx0, bY + 3.9, cz0));
      P.add('copper', G.cyl(0.08, 0.12, 2.6, cx0, bY + 9.0, cz0, 8), new THREE.SphereGeometry(0.35, 12, 8).translate(cx0, bY + 8.3, cz0));
      anchors.top = V3(cx0, bY + 10.3, cz0);
    } else anchors.top = V3(cx0, tb + 6.7, cz0);
  } else if (top === 'dome') {
    const dY = H + 3.4, R = Math.min(W, D) * 0.28;
    P.add('wall', G.cyl(R + 0.8, R + 0.8, 2.0, cx0, dY, cz0, 32));
    P.add('wall', G.cyl(R, R, 4.2, cx0, dY + 3.1, cz0, 32));
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; for (const g of column('ionic', 0.3, 3.6)) P.add('col', g.translate(cx0 + Math.cos(a) * (R + 0.5), dY + 1.0, cz0 + Math.sin(a) * (R + 0.5))); }
    P.add('trim', G.cyl(R + 1.0, R + 1.0, 0.6, cx0, dY + 5.1, cz0, 32));
    P.add('copper', new THREE.SphereGeometry(R, 40, 14, 0, TAU, 0, Math.PI / 2).scale(1, 0.85, 1).translate(cx0, dY + 5.3, cz0));
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10 * Math.PI / 2; pts.push(V3(cx0 + Math.cos(a) * (R + 0.06) * Math.cos(t), dY + 5.3 + (R * 0.85 + 0.06) * Math.sin(t), cz0 + Math.sin(a) * (R + 0.06) * Math.cos(t))); } P.add('copper', G.tube(pts, 0.1, 12, 5)); }
    P.add('trim', G.cyl(1.0, 1.2, 2.0, cx0, dY + 5.3 + R * 0.85 + 1.0, cz0, 12));
    anchors.top = V3(cx0, dY + 5.3 + R * 0.85 + 2.5, cz0);
  }
  // ---- the lawn: a flagpole, two lamp standards at the steps (lit globes)
  const fp = o.flagpole ?? true;
  if (fp) { P.add('pole', G.cyl(0.08, 0.14, 18, -W * 0.35, 9, zf + 16, 10), new THREE.SphereGeometry(0.2, 10, 8).translate(-W * 0.35, 18.1, zf + 16)); anchors.flagTop = V3(-W * 0.35, 17.6, zf + 16); }
  for (const sx of [-1, 1]) { P.add('pole', G.cyl(0.1, 0.16, 4.2, sx * (portW / 2 + 1.25), plinth + 0.6 + 2.1, pz + 4.6, 10)); P.add('globe', new THREE.SphereGeometry(0.35, 16, 10).translate(sx * (portW / 2 + 1.25), plinth + 0.6 + 4.5, pz + 4.6)); lights.push({ kind: 'lamp', pos: V3(sx * (portW / 2 + 1.25), plinth + 5.1, pz + 4.6), color: 0xffd8a0 }); }

  const age = o.wear ?? range(r, 0.25, 0.6);
  const wallM = mat('civicWall' + stoneK, { color: st.color, rough: 0.85, wear: { joints: st.joints, grime: age * 0.5, grimeH: 3.5, streak: 1.4, grimeColor: [0.22, 0.2, 0.17], wobble: 0.18, speck: 0.05, speckColor: [0.3, 0.3, 0.28], speckScale: 14 } });
  const trimCol = brick || stoneK === 'red' ? 0xd6ccb6 : new THREE.Color(st.color).offsetHSL(0, -0.02, 0.05).getHex();
  const trimM = mat('civicTrim' + stoneK, { color: trimCol, rough: 0.8, wear: { grime: age * 0.45, grimeH: 2.0, streak: 1.6, edge: 0.4, edgeColor: [0.92, 0.9, 0.84], wobble: 0.12, grimeColor: [0.24, 0.22, 0.18] } });
  const lit = o.lit ?? 0.6;
  const mats = {
    wall: wallM, trim: trimM, col: trimM, frieze: trimM, step: mat('civicStep', { color: trimCol, rough: 0.75, wear: { grime: 0.5, grimeH: 0.6, joints: { h: 0.215, l: 1.8, w: 0.01, k: 0.5, color: [0.3, 0.28, 0.24] } } }),
    plinth: mat('civicPlinth' + stoneK, { color: new THREE.Color(trimCol).multiplyScalar(0.86).getHex(), rough: 0.85, wear: { grime: age * 0.7, grimeH: 1.4, joints: { h: 0.38, l: 1.5, w: 0.03, k: 0.7, color: [0.2, 0.18, 0.15] } } }),
    reveal: mat('reveal', { color: 0x2a2620, rough: 0.9 }), tymp: mat('tymp', { color: new THREE.Color(trimCol).multiplyScalar(0.72).getHex(), rough: 0.85, wear: { grime: 0.3, grimeH: 2 } }),
    glass: fin('glass', { env: 0.9 }), glassLit: mat('glassLit', { color: 0x5a3a18, rough: 0.2, emissive: 0xffa050, emissiveIntensity: 0.9 * lit }),
    sash: mat('sash', { color: 0xe9e4d6, rough: 0.5 }), door: mat('door', { color: 0x1a120c, rough: 0.5, metal: 0.1 }), doorP: mat('doorP', { color: 0x24180f, rough: 0.45 }),
    transom: mat('transom', { color: 0x7a4a1a, emissive: 0xffa040, emissiveIntensity: 1.6 * lit }),
    roof: mat('roofTin', { color: 0x3a3e3c, rough: 0.6, metal: 0.4, wear: { speck: 0.3, speckColor: [0.35, 0.22, 0.12] } }),
    copper: mat('verdigris', { color: 0x3f6a5c, rough: 0.55, metal: 0.25, wear: { streak: 1.5, grime: 0.3, grimeH: 60, grimeColor: [0.16, 0.26, 0.22], wobble: 0.25 } }),
    clock: new THREE.MeshStandardMaterial({ map: clockTex(...(o.clock ?? [2, 0])), emissive: 0xffffff, emissiveMap: clockTex(...(o.clock ?? [2, 0])), emissiveIntensity: 0.9 * lit, roughness: 0.4 }),
    inscr: new THREE.MeshStandardMaterial({ map: inscriptionTex(ins, trimCol), roughness: 0.8 }),
    pole: mat('pole', { color: 0x1a1a1a, rough: 0.4, metal: 0.6 }), globe: mat('globe', { color: 0xfff0d8, emissive: 0xffd8a0, emissiveIntensity: 3 * lit }),
  };
  const grp = P.build(mats);
  return finish(grp, { type: 'civic', variant: { order, cols, storeys, stone: stoneK, top, wings, bays }, ref: `county courthouse, ${order} ${cols === 6 ? 'hexastyle' : 'tetrastyle'} portico, ${storeys} storeys, ${top} (HABS county-courthouse class)`, anchors, lights });
}
