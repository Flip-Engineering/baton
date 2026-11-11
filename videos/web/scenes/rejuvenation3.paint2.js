// REJUVENATION c16 painters (v6): the poured-concrete dam that replaces the white ziggurat, a low oblique mill town that
// replaces the top-down tile grid, the red room that builds on every return and ends as the furnace mouth, and the welder as a
// real person (hero.js sprites baked by web/labs/rejuv/bake.mjs). Young state only, like rejuvenation3.paint.js: the age pass
// in the scene prints it as newsprint. Deterministic in its arguments. Nothing here comes from any other piece.
import { W, H, clamp, lerp, ease, rng, acpEmblem } from '../lib/kit.js';
import { P, poly, rect, plume, coolingTower, arcLight, lerpCol } from './rejuvenation3.paint.js';

// ---------------------------------------------------------------- the dam: a concrete gravity dam poured in staggered monoliths
// cx, baseY: the foot at the canyon floor; s: scale (1 = a 1000 px wide wall, about 640 px tall when finished).
// levels: how far it has poured (0..5.2 = finished): each block rises a lift at a time, the blocks do not rise together,
// the last lift of a block is wet and still in its forms, a cableway bucket swings over it.
export function dam(g, cx, baseY, s, { levels = 99, shadow = true, cable = true, t = 0 } = {}) {
  const Wd = 1000 * s, N = 8, bw = Wd / N, lift = 34 * s, x0 = cx - Wd / 2, p = clamp(levels / 5.2);
  const r = rng(77);
  const base = i => 11.5 + 2.2 * Math.sin(Math.PI * (i + 0.5) / N) - (i > 5 ? (i - 5) * 1.6 : 0) + (i % 2 ? -1.0 : 0.4);   // finished height in lifts
  const delay = Array.from({ length: N }, () => 0.3 * r());
  const hl = Array.from({ length: N }, (_, i) => base(i) * clamp(p * 1.32 - delay[i]));       // lifts poured (fractional: the wet one)
  const crest = Math.max(...hl) * lift;
  const done = p >= 0.999;          // c17: a FINISHED dam is one curved crest with its reservoir behind and a spillway pouring down its face
  const crestFn = u => lift * (11.2 + 2.5 * Math.sin(Math.PI * u)) - (u > 0.57 && u < 0.69 ? lift * 2.1 * Math.sin(Math.PI * (u - 0.57) / 0.12) ** 0.6 : 0);   // px of height at u (0..1 across)
  const crestTop = done ? Math.max(...Array.from({ length: 40 }, (_, k) => crestFn(k / 39))) : crest;
  // ground shadow of the wall, to the right (the sun is up-left)
  if (shadow) { g.save(); g.globalAlpha = 0.45; poly(g, [[x0, baseY], [x0 + Wd + 120 * s, baseY], [x0 + Wd + 620 * s, baseY + 150 * s], [x0 + 420 * s, baseY + 150 * s]], '#44403c'); g.restore(); }
  // the rock of the canyon either side: warm strata, the right wall in shade
  const rk = (sx, tone, shade) => {
    const xa = sx < 0 ? x0 + 6 * s : x0 + Wd - 6 * s, xb = xa + sx * 640 * s, hh = Math.max(crest * 1.5, 420 * s);
    poly(g, [[xa, baseY], [xb, baseY], [xb, baseY - hh * 0.55], [lerp(xa, xb, 0.55), baseY - hh * 0.95], [xa, baseY - hh * 1.04]], tone);
    g.save(); g.beginPath(); g.moveTo(xa, baseY); g.lineTo(xb, baseY); g.lineTo(xb, baseY - hh * 0.55); g.lineTo(lerp(xa, xb, 0.55), baseY - hh * 0.95); g.lineTo(xa, baseY - hh * 1.04); g.closePath(); g.clip();
    g.strokeStyle = shade; g.lineWidth = 2.2 * s + 1; for (let k = 1; k < 14; k++) { const y = baseY - k * hh * 0.08; g.beginPath(); g.moveTo(xa, y + (sx < 0 ? 24 : -24) * s); g.lineTo(xb, y - (sx < 0 ? 40 : -40) * s); g.stroke(); }
    g.restore();
  };
  rk(-1, '#c4a77f', 'rgba(110,80,50,0.45)'); rk(1, '#8d7656', 'rgba(50,34,22,0.5)');
  if (done) damFinished(g, { x0, Wd, baseY, lift, s, t, crestFn, crestTop });
  // the monoliths
  for (let i = 0; !done && i < N; i++) {
    const nl = Math.floor(hl[i]), fr = hl[i] - nl, hpx = nl * lift, bx = x0 + i * bw, wet = fr > 0.02 && hl[i] < base(i) - 0.001;
    if (hl[i] < 0.05) continue;
    const full = hpx + (wet ? fr * lift : 0);
    // face: lit concrete, lighter at the left of each block, formwork lines every lift
    // c21: the blocks pour at different ages, so their concrete differs (fresh and dark at the foot of a lift, cured and pale above), and
    // the face is greyer than the finished dam's: at phone size the pour read as white bars on a blank sky (a bar chart)
    const age = 0.55 + 0.45 * ((i * 37) % 5) / 4;
    const gr = g.createLinearGradient(bx, 0, bx + bw, 0); gr.addColorStop(0, lerpCol('#c9c2b4', '#ece6d8', age)); gr.addColorStop(0.8, lerpCol('#b3ab9c', '#d6cfc0', age)); gr.addColorStop(1, '#8f887c'); g.fillStyle = gr; g.fillRect(bx, baseY - hpx, bw - 1, hpx);
    { const vg = g.createLinearGradient(0, baseY - hpx, 0, baseY); vg.addColorStop(0, 'rgba(255,250,236,0.18)'); vg.addColorStop(1, 'rgba(60,52,44,0.28)'); g.fillStyle = vg; g.fillRect(bx, baseY - hpx, bw - 1, hpx); }
    for (let k = 0; k < 3; k++) { const y = baseY - hpx + (0.2 + 0.3 * k) * hpx; g.fillStyle = 'rgba(120,100,80,0.12)'; g.fillRect(bx + bw * (0.1 + 0.25 * ((i + k) % 3)), y, 3 * s + 1, hpx * 0.25); }   // laitance streaks
    g.strokeStyle = 'rgba(118,108,94,0.42)'; g.lineWidth = Math.max(1, 1.6 * s);
    for (let k = 1; k <= nl; k++) { const y = baseY - k * lift; g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + bw - 1, y); g.stroke(); rect(g, bx, y - 1.2 * s, bw - 1, 1.5 * s, 'rgba(255,255,255,0.5)'); }
    // contraction joint on the left of the block, shade on its right where the neighbour is lower
    rect(g, bx, baseY - hpx, 3 * s + 1, hpx, 'rgba(70,64,58,0.55)');
    const nxt = i < N - 1 ? Math.floor(hl[i + 1]) * lift : 0;
    if (nxt < hpx) { const sd = 0.2 * bw; poly(g, [[bx + bw - 1, baseY - hpx], [bx + bw - 1 + sd, baseY - hpx - sd * 0.3], [bx + bw - 1 + sd, baseY - nxt - sd * 0.3], [bx + bw - 1, baseY - nxt]], '#a8a398'); }
    // the top of the block: a pale cured top, or the wet lift in its forms
    if (!wet) { poly(g, [[bx, baseY - hpx], [bx + bw - 1, baseY - hpx], [bx + bw - 1 + 0.2 * bw, baseY - hpx - 0.06 * bw], [bx + 0.2 * bw, baseY - hpx - 0.06 * bw]], '#f3eee2'); }   // the cured top, seen from above
    else {
      const wy = baseY - hpx - fr * lift;
      rect(g, bx, wy, bw - 1, fr * lift, '#8a847b');                                      // wet concrete, still dark
      rect(g, bx - 3 * s, wy - 6 * s, bw + 5 * s, 7 * s, P.yellow);                          // the walers on the forms
      g.strokeStyle = '#2a2420'; g.lineWidth = Math.max(1, 2 * s); for (let k = 0; k < 4; k++) { const x = bx + bw * (0.16 + 0.22 * k); g.beginPath(); g.moveTo(x, wy - 4 * s); g.lineTo(x, wy - 30 * s); g.stroke(); }   // rebar sticking up
    }
  }
  // the cableway: two steel towers on the rims, the main cable, a bucket on its fall line
  if (cable && s < 1.1) {
    const ty = baseY - Math.max(crest + 190 * s, 640 * s), lx = x0 - 170 * s, rx = x0 + Wd + 170 * s;
    g.strokeStyle = '#1d1a1c'; g.lineWidth = Math.max(2, 5 * s);
    for (const [tx, sg] of [[lx, 1], [rx, -1]]) {
      g.beginPath(); g.moveTo(tx - 34 * s, baseY - 60 * s); g.lineTo(tx, ty); g.lineTo(tx + 34 * s, baseY - 60 * s); g.stroke();
      g.lineWidth = Math.max(1, 2 * s); for (let k = 1; k < 7; k++) { const y = lerp(baseY - 60 * s, ty, k / 7), hw = lerp(34, 2, k / 7) * s; g.beginPath(); g.moveTo(tx - hw, y); g.lineTo(tx + hw, y + 14 * s); g.moveTo(tx + hw, y); g.lineTo(tx - hw, y + 14 * s); g.stroke(); }
      g.lineWidth = Math.max(2, 5 * s);
    }
    g.lineWidth = Math.max(1.5, 3 * s); g.beginPath(); g.moveTo(lx, ty); g.quadraticCurveTo((lx + rx) / 2, ty + 120 * s, rx, ty); g.stroke();
    const u = 0.5 + 0.28 * Math.sin(t * 0.9), bxp = lerp(lx, rx, u), byp = ty + 2 * 120 * s * u * (1 - u) * 1.0 + 0;
    const drop = 130 * s + 150 * s * (0.5 + 0.5 * Math.sin(t * 1.3));
    g.lineWidth = Math.max(1, 2 * s); g.beginPath(); g.moveTo(bxp, byp); g.lineTo(bxp, byp + drop); g.stroke();
    poly(g, [[bxp - 24 * s, byp + drop], [bxp + 24 * s, byp + drop], [bxp + 15 * s, byp + drop + 38 * s], [bxp - 15 * s, byp + drop + 38 * s]], '#2a2f38');
    rect(g, bxp - 24 * s, byp + drop - 4 * s, 48 * s, 6 * s, P.yellow);
  }
  return { top: baseY - (done ? crestTop : crest), W: Wd, H: done ? crestTop : crest };
}

// c17: the finished dam. One continuous curved crest (a gentle arch over the canyon), a parapet and rail along it, the reservoir
// standing behind it at crest level (a pale far shore, ripples, a dark shoreline against the crest), contraction joints and form
// lines on the face, and a spillway: a notch in the crest with white water sheeting down the face to a plunge pool with spray.
function damFinished(g, { x0, Wd, baseY, lift, s, t, crestFn, crestTop }) {
  const NX = 64, Y = u => baseY - crestFn(u), X = u => x0 + u * Wd;
  const rr = rng(31);
  // the reservoir: a lake in the canyon behind the crest, level with it, narrowing up the valley
  { const top = baseY - crestTop - Wd * 0.11;
    g.save(); g.beginPath(); g.moveTo(X(0) - 6 * s, baseY - crestFn(0) + 4 * s);
    for (let k = 0; k <= NX; k++) g.lineTo(X(k / NX), Y(k / NX) - 3 * s);
    g.lineTo(X(1) + 6 * s, baseY - crestFn(1) + 4 * s); g.lineTo(X(0.9), top); g.quadraticCurveTo(X(0.5), top - 22 * s, X(0.1), top); g.closePath();
    const wg = g.createLinearGradient(0, top, 0, baseY - crestTop); wg.addColorStop(0, '#c4dde8'); wg.addColorStop(0.5, '#7fb0cb'); wg.addColorStop(1, '#3f7ea3');
    g.fillStyle = wg; g.fill(); g.clip();
    for (let k = 0; k < 16; k++) { const yy = lerp(top + 6 * s, baseY - crestTop, (k + 0.5) / 16), w = (24 + rr() * 70) * s * (0.4 + (k + 1) / 16), xx = x0 + rr() * Wd; g.strokeStyle = `rgba(255,255,255,${0.12 + 0.28 * (k / 16)})`; g.lineWidth = Math.max(1, (1 + 2 * k / 16) * s); g.beginPath(); g.moveTo(xx - w / 2 + 6 * Math.sin(t * 1.3 + k), yy); g.lineTo(xx + w / 2 + 6 * Math.sin(t * 1.3 + k), yy); g.stroke(); }
    g.restore(); }
  // the body of the dam: ONE polygon under the curved crest
  g.beginPath(); g.moveTo(X(0), baseY); for (let k = 0; k <= NX; k++) g.lineTo(X(k / NX), Y(k / NX)); g.lineTo(X(1), baseY); g.closePath();
  const gr = g.createLinearGradient(x0, 0, x0 + Wd, 0); gr.addColorStop(0, '#f8f4ea'); gr.addColorStop(0.7, '#e6e1d4'); gr.addColorStop(1, '#cfc9ba'); g.fillStyle = gr; g.fill();
  g.save(); g.clip();
  g.strokeStyle = 'rgba(118,108,94,0.42)'; g.lineWidth = Math.max(1, 1.6 * s);
  for (let y = baseY - lift; y > baseY - crestTop; y -= lift) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + Wd, y); g.stroke(); rect(g, x0, y - 1.2 * s, Wd, 1.5 * s, 'rgba(255,255,255,0.5)'); }
  for (let i = 1; i < 8; i++) rect(g, x0 + i * Wd / 8, baseY - crestTop - 4, 3 * s + 1, crestTop + 8, 'rgba(70,64,58,0.5)');           // contraction joints
  const sh = g.createLinearGradient(0, baseY - crestTop, 0, baseY); sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(1, 'rgba(60,50,40,0.22)'); g.fillStyle = sh; g.fillRect(x0, baseY - crestTop, Wd, crestTop);
  g.restore();
  // the parapet and its rail follow the crest
  g.strokeStyle = '#fffdf7'; g.lineWidth = 7 * s + 1; g.beginPath(); for (let k = 0; k <= NX; k++) { const u = k / NX; k ? g.lineTo(X(u), Y(u) - 2 * s) : g.moveTo(X(u), Y(u) - 2 * s); } g.stroke();
  g.strokeStyle = '#3a3836'; g.lineWidth = Math.max(1, 2 * s); g.beginPath(); for (let k = 0; k <= NX; k++) { const u = k / NX; k ? g.lineTo(X(u), Y(u) - 14 * s) : g.moveTo(X(u), Y(u) - 14 * s); } g.stroke();
  for (let k = 0; k <= 32; k++) { const u = k / 32; if (u > 0.55 && u < 0.71) continue; rect(g, X(u) - 0.8 * s, Y(u) - 14 * s, 1.6 * s + 0.6, 12 * s, '#3a3836'); }
  // the spillway: the water comes over the notch in the crest and sheets down the face
  { const u0 = 0.63, lipY = Y(u0) + 4 * s, w0 = 0.085 * Wd, w1 = 0.15 * Wd, cxs = X(u0), foot = baseY;
    g.save(); g.beginPath(); g.moveTo(cxs - w0 / 2, lipY - 2 * s); g.lineTo(cxs + w0 / 2, lipY - 2 * s); g.bezierCurveTo(cxs + w0 / 2 + 8 * s, lipY + (foot - lipY) * 0.55, cxs + w1 / 2, foot - 40 * s, cxs + w1 / 2 + 10 * s, foot); g.lineTo(cxs - w1 / 2 - 10 * s, foot);
    g.bezierCurveTo(cxs - w1 / 2, foot - 40 * s, cxs - w0 / 2 - 8 * s, lipY + (foot - lipY) * 0.55, cxs - w0 / 2, lipY - 2 * s); g.closePath();
    const sg = g.createLinearGradient(0, lipY, 0, foot); sg.addColorStop(0, '#d8eef7'); sg.addColorStop(0.2, '#ffffff'); sg.addColorStop(1, '#eaf6fb'); g.fillStyle = sg; g.fill(); g.clip();
    for (let k = 0; k < 26; k++) { const xx = cxs + (rr() - 0.5) * w1, ph = (t * (0.9 + rr() * 0.8) + rr() * 3) % 1, y0s = lerp(lipY, foot, ph), len = (80 + rr() * 150) * s;
      g.strokeStyle = k % 3 ? 'rgba(160,205,225,0.55)' : 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(1, (2 + rr() * 3) * s); g.beginPath(); g.moveTo(xx, y0s - len); g.lineTo(xx + (xx - cxs) * 0.05, y0s); g.stroke(); }
    g.restore();
    // the plunge pool: foam and a plume of spray at the foot, rising and falling
    g.save(); g.fillStyle = 'rgba(244,251,255,0.95)'; g.beginPath(); g.ellipse(cxs, foot + 6 * s, w1 * 0.9, 26 * s, 0, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(190,225,240,0.7)'; g.beginPath(); g.ellipse(cxs, foot + 22 * s, w1 * 1.35, 30 * s, 0, 0, 6.3); g.fill();
    for (let k = 0; k < 22; k++) { const ph = (t * 0.8 + k * 0.137) % 1, a = (1 - ph) * 0.75, xx = cxs + (rr() - 0.5) * w1 * 1.3, yy = foot - 6 * s - ph * 150 * s * (0.4 + rr() * 0.6), r2 = (7 + 14 * ph + rr() * 6) * s;
      g.fillStyle = `rgba(250,253,255,${a.toFixed(3)})`; g.beginPath(); g.arc(xx, yy, r2, 0, 6.3); g.fill(); }
    g.restore(); }
}


// ---------------------------------------------------------------- a mill town seen low and oblique, the horizon in frame
// hor: the horizon's y; f: focal (px); the street runs to the vanishing point (540, hor). p (0..1): lights and smoke come back.
export function townOblique(g, { t = 0, p = 1, hor = 760, f = 880, camH = 1.7, seed = 21 } = {}) {
  const r = rng(seed);
  const X = (x, z) => 540 + x * f / z, Y = (y, z) => hor + (camH - y) * f / z;
  // sky, far hills, haze
  const sg = g.createLinearGradient(0, 0, 0, hor); sg.addColorStop(0, P.skyTop); sg.addColorStop(1, '#dbe6e6'); g.fillStyle = sg; g.fillRect(0, 0, W, hor + 2);
  g.fillStyle = '#9fb0b8'; g.beginPath(); g.moveTo(0, hor); for (let x = 0; x <= W; x += 60) g.lineTo(x, hor - 40 - 30 * Math.sin(x * 0.006 + 1) - 20 * Math.sin(x * 0.017)); g.lineTo(W, hor); g.closePath(); g.fill();
  // the mill at the end of the street: sawtooth sheds, a row of stacks with plumes, a gasholder
  const mill = (zc, wm) => {
    const z = zc, top = Y(14, z), bot = Y(0, z);
    rect(g, X(-wm, z), top, X(wm, z) - X(-wm, z), bot - top, '#8c4a38');
    for (let k = 0; k < 9; k++) { const xa = X(-wm + k * wm * 2 / 9, z), xb = X(-wm + (k + 1) * wm * 2 / 9, z); poly(g, [[xa, top], [xa, top - 70], [xb, top], [xb, top]], k % 2 ? '#b9c0c7' : '#8e97a2'); poly(g, [[xa, top], [xa, top - 70], [lerp(xa, xb, 0.1), top - 70], [xb, top]], '#a7aeb6'); }
    for (let k = 0; k < 8; k++) rect(g, X(-wm + 0.9 + k * (wm * 2 - 1.8) / 8, z), top + 40, 26, bot - top - 70, '#23324a');
  };
  mill(70, 38);
  const stacks = [[-24, 34, 70], [-10, 44, 70], [6, 38, 70], [22, 30, 70]];
  for (const [sx, sh, sz] of stacks) { const xa = X(sx, sz), yt = Y(sh, sz), yb = Y(0, sz); poly(g, [[xa - 5, yb], [xa + 5, yb], [xa + 3.6, yt], [xa - 3.6, yt]], '#5e3a2e'); rect(g, xa - 4, yt, 8, 3, '#e9e1d2');
    plume(g, xa, yt, clamp(p * 1.15 - 0.2 * Math.abs(sx) / 24), { scale: 0.33, t, maxH: 520, seed: Math.round(sx) + 9, wind: 0.5 }); }
  // the ground plane: a hard line, then the street in asphalt, the verges and sidewalks
  g.fillStyle = '#b9ae98'; g.fillRect(0, hor, W, H - hor);
  const sw = 3.6, kb = 4.6;           // half street, half street + sidewalk
  poly(g, [[X(-sw, 1.2), H], [X(sw, 1.2), H], [X(sw, 90), Y(0, 90)], [X(-sw, 90), Y(0, 90)]], '#59575a');
  for (const sg2 of [-1, 1]) poly(g, [[X(sg2 * sw, 1.2), H], [X(sg2 * kb, 1.2), H], [X(sg2 * kb, 90), Y(0, 90)], [X(sg2 * sw, 90), Y(0, 90)]], '#d4cbb8');
  for (let z = 2; z < 90; z *= 1.28) poly(g, [[X(-0.12, z), Y(0, z)], [X(0.12, z), Y(0, z)], [X(0.12, z * 1.13), Y(0, z * 1.13)], [X(-0.12, z * 1.13), Y(0, z * 1.13)]], P.yellow);
  // streetcar rails
  g.strokeStyle = '#8e8e92'; g.lineWidth = 3; for (const xr of [-0.9, 0.9]) { g.beginPath(); g.moveTo(X(xr, 1.2), H); g.lineTo(X(xr, 90), Y(0, 90)); g.stroke(); }
  // church and water tower set back, mid-distance
  { const z = 30, x = -13; rect(g, X(x, z), Y(11, z), X(x + 7, z) - X(x, z), Y(0, z) - Y(11, z), '#d9cfba'); poly(g, [[X(x, z), Y(11, z)], [X(x + 7, z), Y(11, z)], [X(x + 3.5, z), Y(17, z)]], '#7d8a94');
    const sp = X(x + 3.5, z); rect(g, sp - 6, Y(21, z), 12, Y(17, z) - Y(21, z), '#e8e0cd'); poly(g, [[sp - 7, Y(21, z)], [sp + 7, Y(21, z)], [sp, Y(30, z)]], '#7d8a94');
    rect(g, X(x + 2.6, z), Y(4, z), 18, Y(0, z) - Y(4, z), '#23324a'); }
  { const z = 38, x = 14; g.strokeStyle = '#2a2a2e'; g.lineWidth = 4; for (const dx of [-3, 3]) { g.beginPath(); g.moveTo(X(x + dx, z), Y(0, z)); g.lineTo(X(x + dx * 0.6, z), Y(13, z)); g.stroke(); }
    g.fillStyle = '#d7dde3'; g.fillRect(X(x - 3.6, z), Y(19, z), X(x + 3.6, z) - X(x - 3.6, z), Y(13, z) - Y(19, z)); poly(g, [[X(x - 3.6, z), Y(19, z)], [X(x, z), Y(21.5, z)], [X(x + 3.6, z), Y(19, z)]], '#9aa4ad'); rect(g, X(x + 1.6, z), Y(19, z), 8, Y(13, z) - Y(19, z), '#a9b3bc'); }
  // utility poles with their crossarms, receding
  g.strokeStyle = '#2a2420'; for (let k = 0; k < 8; k++) { const z = 2.4 * Math.pow(1.46, k), xa = X(-4.9, z); g.lineWidth = Math.max(1.5, 160 / z * 0.06); g.beginPath(); g.moveTo(xa, Y(0, z)); g.lineTo(xa, Y(9.5, z)); g.stroke(); g.beginPath(); g.moveTo(xa - 1.1 * f / z, Y(9, z)); g.lineTo(xa + 1.1 * f / z, Y(9, z)); g.stroke(); }
  // rowhouses both sides, far to near: each a brick facade in perspective with floors of windows (lit as the wave passes)
  const cols = ['#a0442e', '#b8543a', '#8e5a3a', '#c28a58', '#7d8a94', '#b0644a'];
  const row = (sgn) => {
    const zs = []; for (let z = 70; z > 1.45; z /= 1.2) zs.push(z);
    for (let i = 0; i < zs.length - 1; i++) {
      const zf = zs[i], zn = zs[i + 1], ht = 9 + 2.5 * ((i * 7 + (sgn > 0 ? 3 : 0)) % 3), xe = sgn * 5.6;
      const c = cols[(i * 5 + (sgn > 0 ? 2 : 0)) % cols.length], sh = sgn > 0 ? 0.78 : 1;
      const q = [[X(xe, zf), Y(0, zf)], [X(xe, zn), Y(0, zn)], [X(xe, zn), Y(ht, zn)], [X(xe, zf), Y(ht, zf)]];
      poly(g, q, lerpCol(c, '#2a1810', sgn > 0 ? 0.22 : 0));
      // a flat roof edge and the party wall's end cap toward the street
      poly(g, [[X(xe, zf), Y(ht, zf)], [X(xe, zn), Y(ht, zn)], [X(xe - sgn * 0.6, zn), Y(ht + 0.4, zn)], [X(xe - sgn * 0.6, zf), Y(ht + 0.4, zf)]], '#e8e1d2');
      const nf = 3, nw = 3;
      for (let fl = 0; fl < nf; fl++) for (let w2 = 0; w2 < nw; w2++) {
        const u0 = (w2 + 0.22) / nw, u1 = (w2 + 0.74) / nw, y0 = 1.0 + fl * 2.7, y1 = y0 + 1.6;
        const za = lerp(zf, zn, u0), zb = lerp(zf, zn, u1);
        const lit = fl === 0 && w2 === 1 ? 0.8 : ((i * 3 + fl * 5 + w2 * 7) % 4 === 0 ? 1 : 0) * p;
        poly(g, [[X(xe, za), Y(y0, za)], [X(xe, zb), Y(y0, zb)], [X(xe, zb), Y(y1, zb)], [X(xe, za), Y(y1, za)]], lit > 0.5 ? '#ffe49a' : '#1d2a40');
      }
      // stoop and door at street level
      const za = lerp(zf, zn, 0.4), zb = lerp(zf, zn, 0.58);
      poly(g, [[X(xe, za), Y(0, za)], [X(xe, zb), Y(0, zb)], [X(xe, zb), Y(2.2, zb)], [X(xe, za), Y(2.2, za)]], '#2d2018');
    }
  };
  row(-1); row(1);
  // a streetcar-wire sag between the poles, and the sun's long shadows of the rows on the street from the left
  g.save(); g.globalAlpha = 0.28; poly(g, [[X(-sw, 1.4), H], [X(-0.2, 1.4), H], [X(-0.2, 40), Y(0, 40)], [X(-sw, 40), Y(0, 40)]], '#2a2a36'); g.restore();
}

// ---------------------------------------------------------------- the red room, hotter every return
// k (0..1): the visit's rank. Deep red -> orange -> a white-yellow core, a wider glow, the camera a step closer, the vermilion
// banner bigger with its gold emblem in the light. furnace: the aperture shows the pour (the last return, after FOUNTAIN OF YOUTH.)
export function redRoom2(g, { k = 0, t = 0, furnace = false, aperture = [310, 360, 460, 820] } = {}) {
  const sc = 1 + 0.32 * k;
  g.save(); g.translate(540, 760); g.scale(sc, sc); g.translate(-540, -760);
  const top = lerpCol('#3a0406', '#4a0a05', k), mid = lerpCol('#b00d14', '#d8340c', k), low = '#2a0304';
  const gr = g.createLinearGradient(0, -300, 0, H + 300); gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, low);
  g.fillStyle = gr; g.fillRect(-600, -400, W + 1200, H + 800);
  const [ax, ay, aw, ah] = aperture, cxm = ax + aw / 2, cym = ay + ah / 2;
  const rg = g.createRadialGradient(cxm, cym, 40, cxm, cym, 900 + 500 * k);
  rg.addColorStop(0, lerpCol('#ff5a46', '#ffb060', k)); rg.addColorStop(1, 'rgba(255,40,30,0)'); g.globalAlpha = 0.9; g.fillStyle = rg; g.fillRect(-600, -400, W + 1200, H + 800); g.globalAlpha = 1;
  // the mouth: a heavy dark lintel above it (steel) and the opening
  if (k > 0.3) { rect(g, ax - 60, ay - 70, aw + 120, 70, '#1d0a08'); rect(g, ax - 60, ay - 14, aw + 120, 14, '#4a1a10'); }
  rect(g, ax, ay, aw, ah, lerpCol('#ff4a36', '#ff8a2a', k));
  rect(g, ax + aw * 0.08, ay + ah * 0.06, aw * 0.84, ah * 0.88, lerpCol('#ff7a52', '#ffc060', k));
  rect(g, ax + aw * 0.22, ay + ah * 0.16, aw * 0.56, ah * 0.68, lerpCol('#ff9a70', '#fff0b0', Math.max(0, k * 1.2 - 0.1)));
  if (furnace) {         // the pour in the aperture: a bright stream from a lip at the top, a white pool, sparks
    const sx = cxm + 20;
    for (let w = 5; w >= 1; w--) { g.strokeStyle = ['#ff6a1c', '#ff9a2a', '#ffc850', '#ffe89a', '#fffbe8'][5 - w]; g.lineWidth = w * 15; g.beginPath(); g.moveTo(sx - 70, ay + 40); g.quadraticCurveTo(sx + 30, ay + 120, sx + 12 * Math.sin(t * 5), ay + ah - 130); g.stroke(); }
    rect(g, ax + 20, ay + ah - 150, aw - 40, 130, '#fff3c4'); rect(g, ax + 60, ay + ah - 120, aw - 120, 90, '#ffffff');
    rect(g, ax, ay + 18, 110, 30, '#2a1410');          // the ladle lip
    arcLight(g, sx, ay + ah - 130, 0.7, t, { sparks: 90, seed: 31, big: 0.9 });
  }
  const fy = ay + ah + 120; rect(g, -600, fy, W + 1200, 2200, '#5a0508');
  const fg = g.createRadialGradient(cxm, fy, 10, cxm, fy, 700 + 300 * k); fg.addColorStop(0, `rgba(255,${Math.round(80 + 120 * k)},50,0.6)`); fg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fg; g.fillRect(-600, fy, W + 1200, 1600);
  g.restore();
  return fy;
}
// the vermilion banner with its gold emblem catching the furnace light: bigger every visit. Planted at the front, right of centre.
export function banner(g, t, k, { x = 790, foot = 1990 } = {}) {
  const w = lerp(230, 430, k), h = lerp(150, 280, k), top = foot - 900 - 160 * k;
  g.strokeStyle = '#150808'; g.lineWidth = 9; g.beginPath(); g.moveTo(x, foot); g.lineTo(x, top - 20); g.stroke();
  g.save(); g.translate(x + 4, top);
  const n = 22; g.beginPath(); g.moveTo(0, 0);
  for (let i = 0; i <= n; i++) { const u = i / n; g.lineTo(u * w, Math.sin(t * 4 + u * 5) * 16 * u); }
  for (let i = n; i >= 0; i--) { const u = i / n; g.lineTo(u * w, h + Math.sin(t * 4 + u * 5 + 0.4) * 16 * u); }
  g.closePath(); g.fillStyle = '#ff3d1f'; g.fill();
  g.clip(); const sg = g.createLinearGradient(0, 0, w, 0); sg.addColorStop(0, 'rgba(255,200,120,0.5)'); sg.addColorStop(0.5, 'rgba(255,200,120,0)'); sg.addColorStop(1, 'rgba(60,0,0,0.5)'); g.fillStyle = sg; g.fillRect(0, -40, w, h + 80);
  acpEmblem(g, w * 0.5, h * 0.5 + Math.sin(t * 4 + 2.5) * 6, h * 0.62, { color: '#ffd27a' });
  g.restore();
}

// ---------------------------------------------------------------- the welder, a real person (sprites baked from hero.js)
const _img = new Map();
export async function loadWelderSprites() {
  const names = ['walt_up', 'ray_up', 'kai_up', 'kai_h5', 'kai_dn', 'kai_mid', 'kai_look', 'kai_l1', 'kai_l2', 'kai_l3', 'kai_l4', 'kai_lit', 'kai_look2'];
  await Promise.all(names.map(n => new Promise(res => { const im = new Image(); im.onload = () => { _img.set(n, im); res(); }; im.onerror = () => res(); im.src = new URL(`../assets/rejuvenation/${n}.png`, import.meta.url).href; })));
}
// c17: a cross-faded run of sprites (u 0..1 along `names`): the hood lifting off a lit face in several baked steps without a pop
export function welderRun(g, names, u, opts = {}) {
  const x = clamp(u) * (names.length - 1), i = Math.min(names.length - 2, Math.floor(x)), f = x - i;
  welderSprite(g, names[i], opts);
  if (f > 0.01) { g.save(); g.globalAlpha = f; welderSprite(g, names[i + 1], { ...opts, fade: false }); g.restore(); }
}
// draw one sprite with the head at (hx, hy) at scale sc, its brightness following the arc
export function welderSprite(g, name, { sc = 1.3, hx = 520, hy = 880, bright = 1, ax = 905, ay = 1235 } = {}) {
  const im = _img.get(name); if (!im) return;
  const ox = hx - 540 * sc, oy = hy - 1040 * sc;
  g.save(); g.filter = `brightness(${bright.toFixed(3)}) saturate(1.05)`; g.drawImage(im, ox, oy, 1080 * sc, 1920 * sc); g.restore();
  // everything below the collarbones sinks into the dark: the arc only lights the face and the shoulder
  const fg = g.createLinearGradient(0, hy + 330, 0, hy + 900); fg.addColorStop(0, 'rgba(6,7,11,0)'); fg.addColorStop(1, 'rgba(6,7,11,0.96)'); g.fillStyle = fg; g.fillRect(0, hy + 330, W, H - hy - 330);
}
