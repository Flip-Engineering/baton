// HORDE figures: rim-lit silhouettes drawn as detailed profiles, never modelled faces.
// Every figure is built as a silhouette mask (any number of shapes, strokes and hair strands), then lit from behind:
// a wide bloom of the backlight through dust, a near-black body, a hard crescent rim on the side facing the sun and a
// thin all-round edge. Details that catch the light (hard-hat gloss, cap mesh, hi-vis tape, beard hairs, the horse's eye
// and bit) are drawn on top. Faces are always in shadow, so they read as people against the sun, not as dolls.
// Pure functions of their inputs (t, phase, seed): no accumulated state.
import { W, H, clamp, lerp, rng } from '../lib/kit.js';

// ---------------------------------------------------------------- canvases
const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d')]; };
const [MC, mg] = mk();          // silhouette mask
const [TC, tg] = mk();          // tint scratch
const [RC, rg] = mk();          // rim scratch

// Catmull-Rom through pts (local units) into a path
function spline(p, pts, closed = true, tension = 0.5) {
  const n = pts.length, P = i => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), k = tension / 3;
    p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]);
  }
  if (closed) p.closePath();
  return p;
}
const poly = (g, pts, closed = true) => { g.beginPath(); spline(g, pts, closed); };
const rot = (p, c, a) => { const s = Math.sin(a), co = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * co - y * s, c[1] + x * s + y * co]; };

function tint(src, color) {
  tg.globalCompositeOperation = 'copy'; tg.filter = 'none'; tg.drawImage(src, 0, 0);
  tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color; tg.fillRect(0, 0, W, H);
  tg.globalCompositeOperation = 'source-over';
  return TC;
}

// ---------------------------------------------------------------- the lighting pass
// draw(g): fills the silhouette into the mask (any colour, alpha counts). sun: screen point of the backlight.
// L: { rim, rim2, body, halo, rimW, bloom, edge }
export function lit(g, draw, sun, L = {}) {
  const rim = L.rim || '#ffc79a', rim2 = L.rim2 || '#ff3a14', body = L.body || '#0a0203';
  mg.setTransform(1, 0, 0, 1, 0, 0); mg.globalCompositeOperation = 'source-over'; mg.filter = 'none'; mg.globalAlpha = 1;
  mg.clearRect(0, 0, W, H);
  mg.save(); mg.fillStyle = '#000'; mg.strokeStyle = '#000'; draw(mg); mg.restore();
  const cx = L.cx ?? W / 2, cy = L.cy ?? H / 2;
  let lx = sun[0] - cx, ly = sun[1] - cy; const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
  // 1. the backlight blooming round the edge through the dust
  g.save(); g.globalCompositeOperation = 'lighter';
  g.globalAlpha = L.halo ?? 0.85; g.filter = `blur(${L.bloom ?? 34}px)`; g.drawImage(tint(MC, rim2), 0, 0);
  g.globalAlpha = (L.halo ?? 0.85) * 0.7; g.filter = 'blur(9px)'; g.drawImage(tint(MC, rim), 0, 0);
  g.restore();
  // 2. the body, near black, a little warm light bouncing up from the dust at the bottom
  g.drawImage(tint(MC, body), 0, 0);
  // 3. the crescent rim on the sun side, plus a thin edge all round
  const w = L.rimW ?? 7;
  rg.globalCompositeOperation = 'copy'; rg.filter = 'none'; rg.drawImage(tint(MC, rim), 0, 0);
  rg.globalCompositeOperation = 'destination-out'; rg.filter = 'blur(2px)'; rg.drawImage(MC, -lx * w, -ly * w);
  rg.filter = 'none'; rg.globalCompositeOperation = 'source-over';
  g.save(); g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(6px)'; g.globalAlpha = 0.9; g.drawImage(RC, 0, 0);
  g.filter = 'blur(0.8px)'; g.globalAlpha = 1; g.drawImage(RC, 0, 0);
  g.restore();
  // thin edge: mask minus its own blur
  rg.globalCompositeOperation = 'copy'; rg.drawImage(tint(MC, rim2), 0, 0);
  rg.globalCompositeOperation = 'destination-out'; rg.filter = 'blur(3px)'; rg.drawImage(MC, 0, 0); rg.drawImage(MC, 0, 0);
  rg.filter = 'none'; rg.globalCompositeOperation = 'source-over';
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = L.edge ?? 0.8; g.drawImage(RC, 0, 0); g.restore();
}

// ---------------------------------------------------------------- the human profile (head unit: chin to crown ~ 1; ear at 0,0; faces +x)
const HEAD_BACK = [[-0.26, 0.42], [-0.36, 0.22], [-0.43, -0.02], [-0.42, -0.30], [-0.28, -0.52], [-0.02, -0.63], [0.24, -0.57], [0.39, -0.42], [0.45, -0.28]];
const FACE_TOP = [[0.475, -0.15], [0.445, -0.085], [0.455, -0.045], [0.525, 0.045], [0.572, 0.110], [0.566, 0.142], [0.51, 0.152], [0.505, 0.20], [0.492, 0.232]];
const JAW = [[0.498, 0.262], [0.49, 0.292], [0.468, 0.322], [0.502, 0.372], [0.498, 0.425], [0.43, 0.458], [0.28, 0.47], [0.17, 0.50]];
const PIVOT = [0.02, 0.06];

// o: { shout 0..1, beard 0..1, nose 0..1 (size), brow, hat: 'hard'|'trucker'|'seed'|'beanie'|'bare', seed, t, wind }
function headOutline(o) {
  const a = (o.shout ?? 0) * 0.34, bd = o.beard ?? 0, ns = 0.9 + 0.35 * (o.nose ?? 0.5), br = (o.brow ?? 0.5) * 0.02;
  const face = FACE_TOP.map(([x, y], i) => i >= 2 && i <= 6 ? [0.44 + (x - 0.44) * ns, y] : i === 0 ? [x + br, y] : [x, y]);
  let jaw = JAW.map(p => rot(p, PIVOT, a));
  if (bd > 0) {           // the beard hangs off the jaw: fuller chin, a ragged underside
    const r = rng(o.seed ?? 1);
    const ab = a * 0.45;       // a beard hangs: it swings less than the jaw
    jaw = [rot([0.50, 0.285], PIVOT, a), rot([0.51, 0.34], PIVOT, a * 0.8), rot([0.53, 0.40 + 0.07 * bd], PIVOT, ab * 1.4),
      rot([0.51, 0.46 + 0.13 * bd], PIVOT, ab * 1.4), rot([0.42, 0.51 + 0.12 * bd + r() * 0.02], PIVOT, ab),
      rot([0.30, 0.53 + 0.07 * bd], PIVOT, ab), [0.18, 0.56 + 0.03 * bd]];
    face[7] = [0.53, 0.20]; face[8] = [0.50, 0.24];   // the moustache over the lip
  }
  const mouth = a > 0.03 ? [[lerp(0.47, 0.40, clamp(a / 0.25)), 0.25], [lerp(0.47, 0.41, clamp(a / 0.25)), lerp(0.255, 0.30, clamp(a / 0.3))]] : [];
  const neck = [[0.18, 0.60], [0.22, 0.76]];
  return [...HEAD_BACK, ...face, ...mouth, ...jaw, ...neck];
}

function hatShape(g, hat, o) {
  const r = rng((o.seed ?? 1) + 5), wind = o.wind ?? 1;
  if (hat === 'hard') {
    poly(g, [[-0.50, -0.30], [-0.50, -0.55], [-0.33, -0.76], [-0.02, -0.85], [0.28, -0.79], [0.45, -0.60], [0.48, -0.36]]); g.fill();
    poly(g, [[-0.60, -0.265], [-0.52, -0.34], [0.46, -0.37], [0.70, -0.31], [0.69, -0.265], [0.44, -0.30], [-0.50, -0.275]]); g.fill();
    poly(g, [[-0.12, -0.84], [0.06, -0.87], [0.10, -0.83], [-0.10, -0.80]]); g.fill();           // the ridge
  } else if (hat === 'trucker') {
    poly(g, [[-0.47, -0.28], [-0.49, -0.55], [-0.32, -0.77], [0.04, -0.86], [0.33, -0.80], [0.46, -0.56], [0.45, -0.34]]); g.fill();
    poly(g, [[0.36, -0.42], [0.62, -0.44], [0.90, -0.37], [0.89, -0.325], [0.62, -0.345], [0.40, -0.31]]); g.fill();
    g.beginPath(); g.arc(0.03, -0.87, 0.035, 0, Math.PI * 2); g.fill();                              // the button
  } else if (hat === 'seed') {
    poly(g, [[-0.47, -0.27], [-0.48, -0.50], [-0.27, -0.71], [0.08, -0.75], [0.36, -0.64], [0.45, -0.40], [0.44, -0.30]]); g.fill();
    poly(g, [[0.38, -0.39], [0.62, -0.38], [0.80, -0.28], [0.79, -0.235], [0.60, -0.29], [0.40, -0.29]]); g.fill();
    g.beginPath(); g.arc(0.06, -0.75, 0.03, 0, Math.PI * 2); g.fill();
  } else if (hat === 'beanie') {
    poly(g, [[-0.48, -0.18], [-0.50, -0.50], [-0.30, -0.76], [0.02, -0.83], [0.32, -0.72], [0.46, -0.44], [0.45, -0.24]]); g.fill();
  } else {                                           // bare: hair streaming back in the wind of the gallop
    poly(g, [[-0.46, 0.05], [-0.52, -0.36], [-0.34, -0.66], [0.02, -0.76], [0.32, -0.66], [0.47, -0.40], [0.40, -0.30], [0.10, -0.46], [-0.2, -0.4]]); g.fill();
    g.lineCap = 'round';
    for (let i = 0; i < 120; i++) {       // tousled, lifted and swept back by the wind
      const u = r(), ang0 = lerp(-0.2, -2.9, u), x0 = Math.cos(ang0) * 0.46 * 0.95 - 0.02, y0 = Math.sin(ang0) * 0.66 - 0.06;
      const ang = ang0 - lerp(0.3, 0.9, r()), len = lerp(0.05, 0.15, r()) * wind, wav = Math.sin((o.t ?? 0) * 11 + i) * 0.02;
      if (x0 > 0.40 && y0 > -0.35) continue;
      g.lineWidth = lerp(0.012, 0.03, r());
      g.beginPath(); g.moveTo(x0 * 0.9, y0 * 0.9); g.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.6, y0 + Math.sin(ang) * len * 0.6 + wav, x0 + Math.cos(ang - 0.3) * len, y0 + Math.sin(ang - 0.3) * len + wav); g.stroke();
    }
  }
  if (hat !== 'bare') {                              // hair under the hat at the nape and temple, blown back
    g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const u = r(), y0 = lerp(-0.27, 0.12, r()), x0 = -0.42 + Math.abs(y0 + 0.05) * 0.2 + u * 0.04, len = lerp(0.03, 0.09, r()) * wind;
      g.lineWidth = lerp(0.005, 0.013, r());
      g.beginPath(); g.moveTo(x0 + 0.03, y0); g.quadraticCurveTo(x0 - len * 0.6, y0 - 0.02, x0 - len, y0 + 0.02 + Math.sin((o.t ?? 0) * 13 + i) * 0.02); g.stroke();
    }
  }
}

function beardHairs(g, o) {              // loose hairs off the beard's edge, whipped back
  const bd = Math.max(o.beard ?? 0, 0.05);
  const r = rng((o.seed ?? 1) + 9), a = (o.shout ?? 0) * 0.34;
  g.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const u = r(), p = rot([lerp(0.54, 0.20, u), lerp(0.38, 0.56, u) + (u < 0.6 ? 0.24 * bd * (1 - Math.abs(u - 0.3) * 2.5) : 0.12 * bd * (1 - u))], PIVOT, a * 0.45);
    const len = lerp(0.03, 0.09, r()) * (bd < 0.1 ? 0.25 : 0.6 + bd), ang = lerp(1.8, 2.8, r()) + Math.sin((o.t ?? 0) * 9 + i) * 0.2;
    g.lineWidth = lerp(0.006, 0.016, r());
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len); g.stroke();
  }
}

// torso in profile, from the neck down past the frame; coat collar up
function torso(g, o) {
  const col = o.coat ?? 'work';
  poly(g, [[0.15, 0.55], [0.20, 0.74], [0.30, 0.86], [0.46, 0.98], [0.60, 1.30], [0.64, 1.9], [0.62, 2.8], [0.58, 4.2],
    [-0.98, 4.2], [-1.04, 2.6], [-1.06, 1.6], [-0.98, 1.16], [-0.66, 0.90], [-0.36, 0.72], [-0.30, 0.44]]); g.fill();
  poly(g, [[0.18, 0.72], [0.33, 0.76], [0.35, 0.86], [0.27, 0.97]]); g.fill();                    // collar points
  poly(g, [[-0.28, 0.58], [-0.40, 0.66], [-0.44, 0.78], [-0.28, 0.76]]); g.fill();
  if (col === 'hood') { poly(g, [[-0.28, 0.40], [-0.60, 0.50], [-0.74, 0.80], [-0.40, 0.86]]); g.fill(); }
}

// raised fist, from the near shoulder; pump 0..1 lifts it
function fist(g, o) {        // the far arm thrown up behind the head, so the profile stays clear
  const p = clamp(o.pump ?? 0.5), S = [-0.55, 1.15], E = [-0.95, lerp(0.35, 0.05, p)], F = [-0.72, lerp(-0.75, -1.35, p)];
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = 0.44; g.beginPath(); g.moveTo(S[0], S[1]); g.lineTo(E[0], E[1]); g.stroke();              // sleeve, bunched at the elbow
  g.lineWidth = 0.30; g.beginPath(); g.moveTo(E[0], E[1]); g.lineTo(F[0], F[1] + 0.22); g.stroke();     // forearm
  g.lineWidth = 0.34; g.beginPath(); g.moveTo(E[0] + 0.02, E[1] - 0.05); g.lineTo(lerp(E[0], F[0], 0.5), lerp(E[1], F[1], 0.5)); g.stroke();  // cuff
  poly(g, [[F[0] - 0.15, F[1] + 0.20], [F[0] - 0.17, F[1] - 0.02], [F[0] - 0.11, F[1] - 0.15], [F[0] - 0.02, F[1] - 0.19], [F[0] + 0.08, F[1] - 0.18],
    [F[0] + 0.17, F[1] - 0.10], [F[0] + 0.19, F[1] + 0.04], [F[0] + 0.14, F[1] + 0.16], [F[0] + 0.02, F[1] + 0.24]]); g.fill();   // the knuckles
  poly(g, [[F[0] + 0.12, F[1] + 0.02], [F[0] + 0.21, F[1] + 0.07], [F[0] + 0.19, F[1] + 0.14], [F[0] + 0.10, F[1] + 0.12]]); g.fill(); // thumb over
  return F;
}
// the whole person into the mask, in local units under the caller's transform
function personMask(g, o) {
  g.save(); if (o.lean) { g.translate(0, 0.6); g.rotate(o.lean); g.translate(0, -0.6); }
  torso(g, o); if (o.fist) fist(g, o); g.restore();
  poly(g, headOutline(o)); g.fill();
  hatShape(g, o.hat ?? 'hard', o);
  beardHairs(g, o);
}

// details that catch the light (drawn additive, local units)
function personDetail(g, o, k = 1) {
  const hat = o.hat ?? 'hard', r = rng((o.seed ?? 1) + 21);
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  if (hat === 'hard') {                               // the hard hat's gloss: a specular band over the dome and the brim's lip
    const gr = g.createLinearGradient(-0.4, -0.8, 0.4, -0.5); gr.addColorStop(0, 'rgba(255,220,190,0)'); gr.addColorStop(0.5, `rgba(255,214,180,${0.55 * k})`); gr.addColorStop(1, 'rgba(255,200,160,0)');
    g.strokeStyle = gr; g.lineWidth = 0.035;
    g.beginPath(); g.moveTo(-0.40, -0.62); g.quadraticCurveTo(-0.05, -0.90, 0.36, -0.68); g.stroke();
    g.strokeStyle = `rgba(255,190,150,${0.35 * k})`; g.lineWidth = 0.012;
    g.beginPath(); g.moveTo(-0.52, -0.30); g.lineTo(0.62, -0.31); g.stroke();
  }
  if (hat === 'trucker') {                            // the sun through the mesh back panel
    g.save(); poly(g, [[-0.47, -0.30], [-0.48, -0.55], [-0.32, -0.76], [-0.02, -0.84], [-0.05, -0.30]]); g.clip();
    g.fillStyle = `rgba(255,150,100,${0.5 * k})`;
    for (let y = -0.86; y < -0.28; y += 0.034) for (let x = -0.5; x < 0; x += 0.034) { g.fillRect(x + ((y * 30) % 2 ? 0.017 : 0), y, 0.012, 0.012); }
    g.restore();
    g.strokeStyle = `rgba(255,190,150,${0.4 * k})`; g.lineWidth = 0.012;
    g.beginPath(); g.moveTo(0.40, -0.315); g.quadraticCurveTo(0.65, -0.35, 0.89, -0.33); g.stroke();
  }
  if (hat === 'seed') { g.strokeStyle = `rgba(255,180,140,${0.35 * k})`; g.lineWidth = 0.01; g.beginPath(); g.moveTo(0.06, -0.74); g.quadraticCurveTo(0.28, -0.62, 0.40, -0.38); g.stroke(); }
  if (hat === 'beanie') { g.strokeStyle = `rgba(255,160,120,${0.3 * k})`; g.lineWidth = 0.01; g.beginPath(); g.moveTo(-0.49, -0.34); g.quadraticCurveTo(0, -0.40, 0.45, -0.34); g.stroke(); }
  // the ear: a lit rim on the helix
  g.strokeStyle = `rgba(255,120,80,${0.16 * k})`; g.lineWidth = 0.01;
  g.beginPath(); g.arc(-0.03, 0.02, 0.085, -2.0, 1.0); g.stroke();
  // hi-vis tape on the coat: the one thing that shines back
  if (o.hivis && o.tape) {
    g.fillStyle = `rgba(255,230,190,${0.42 * k})`;
    for (const y of [1.55, 2.25]) { g.beginPath(); g.moveTo(-1.05, y); g.lineTo(0.63, y - 0.04); g.lineTo(0.63, y + 0.05); g.lineTo(-1.05, y + 0.09); g.fill(); }
  }
  // sweat glint on the brow line and the tip of the nose (tiny)
  g.fillStyle = `rgba(255,200,160,${0.5 * k})`;
  g.beginPath(); g.arc(0.555 + 0.02 * ((o.nose ?? 0.5) - 0.5), 0.115, 0.008, 0, Math.PI * 2); g.fill();
  g.restore();
}

// breath/spit vapour off the shout, blown back along the head (lit by the sun behind)
export function breath(g, x, y, dir, s, t, amt = 1, seed = 1) {
  const r = rng(seed);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const ph = ((t * lerp(0.9, 1.6, r()) + r()) % 1), px = x + dir * (0.12 + ph * lerp(0.25, 0.6, r())) * s, py = y + (-ph * lerp(0.1, 0.6, r()) + (r() - 0.5) * 0.1) * s;
    const rr = lerp(0.03, 0.16, ph) * s * lerp(0.7, 1.3, r()), a = amt * 0.13 * Math.sin(ph * Math.PI);
    const gr = g.createRadialGradient(px, py, 0, px, py, rr); gr.addColorStop(0, `rgba(255,200,170,${a})`); gr.addColorStop(1, 'rgba(255,120,80,0)');
    g.fillStyle = gr; g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  g.restore();
}

// a person in profile. P: {x, y (ear), s (px per head unit), face (1 right / -1 left), ...o}
export function person(g, P, sun, L = {}) {
  const t = P.t ?? 0;
  lit(g, m => { m.translate(P.x, P.y); m.rotate(P.tilt ?? 0); m.scale(P.s * P.face, P.s); personMask(m, P); }, sun, { cx: P.x, cy: P.y, ...L });
  g.save(); g.translate(P.x, P.y); g.rotate(P.tilt ?? 0); g.scale(P.s * P.face, P.s); personDetail(g, P, L.detail ?? 1); g.restore();
  if ((P.shout ?? 0) > 0.2) {
    const m = rot([0.40, 0.27], PIVOT, (P.shout ?? 0) * 0.17);
    breath(g, P.x + m[0] * P.s * P.face, P.y + m[1] * P.s, P.face, P.s, t * 1.3, P.shout, P.seed ?? 3);
  }
}

// ---------------------------------------------------------------- the horse: head and neck in profile (unit: poll to muzzle ~ 1; poll at 0,0; faces +x)
function horseMask(g, o) {
  const t = o.t ?? 0, ph = o.phase ?? 0, r = rng((o.seed ?? 1) + 40), open = 0.02 + 0.03 * Math.max(0, Math.sin(ph * Math.PI * 2));
  const pts = [[0, 0], [0.12, 0.03], [0.30, 0.12], [0.50, 0.26], [0.70, 0.40], [0.86, 0.50], [0.95, 0.56], [0.99, 0.63], [0.995, 0.70],
    [0.97, 0.76], [0.93, 0.78 + open * 0.3], [0.95, 0.81 + open], [0.90, 0.845 + open], [0.80, 0.83 + open * 0.5], [0.66, 0.76], [0.50, 0.71], [0.34, 0.715],
    [0.22, 0.65], [0.15, 0.53], ...(o.noNeck ? [[0.08, 0.66], [-0.05, 0.85], [-0.55, 0.70], [-0.45, 0.35], [-0.25, 0.10], [-0.08, 0.015]]
      : [[0.10, 0.63], [0.03, 0.92], [-0.08, 1.35], [-0.18, 2.2], [-1.4, 2.2], [-1.12, 1.4], [-0.86, 0.86], [-0.58, 0.40], [-0.30, 0.13], [-0.08, 0.015]])];
  poly(g, pts); g.fill();
  for (const [dx, a] of [[0.02, 0.10], [-0.07, -0.08]]) {             // ears, pricked forward, flicking on the stride
    g.save(); g.translate(dx, 0.02); g.rotate(a + 0.08 * Math.sin(ph * Math.PI * 2 + dx * 20));
    poly(g, [[-0.07, 0.02], [-0.085, -0.13], [-0.03, -0.29], [0.02, -0.34], [0.05, -0.22], [0.07, -0.03]]); g.fill(); g.restore();
  }
  g.lineCap = 'round';
  const ce = o.crest ?? [-1.25, 1.55], cang = Math.atan2(ce[1], ce[0]);
  for (let i = 0; i < 220; i++) {                                     // the mane, streaming back along the crest in the wind of the gallop
    const u = r(), base = [lerp(-0.02, ce[0], u), lerp(0.01, ce[1], u)];
    const len = lerp(0.10, 0.34, r()) * (1 - u * 0.4), wav = Math.sin(t * 10 + i * 0.7 + u * 6) * 0.04;
    const ang = cang - 0.35 + (r() - 0.5) * 0.35;
    g.lineWidth = lerp(0.006, 0.02, r());
    g.beginPath(); g.moveTo(base[0] + 0.03, base[1] + 0.02);
    g.quadraticCurveTo(base[0] + Math.cos(ang) * len * 0.5, base[1] + Math.sin(ang) * len * 0.5 + wav, base[0] + Math.cos(ang - 0.15) * len, base[1] + Math.sin(ang - 0.15) * len + wav * 2);
    g.stroke();
  }
  for (let i = 0; i < 26; i++) {                                      // forelock blown back between the ears
    const len = lerp(0.1, 0.26, r()), y0 = lerp(0.0, 0.12, r()), x0 = lerp(0.0, 0.12, r());
    g.lineWidth = lerp(0.008, 0.02, r());
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 - len * 0.5, y0 - 0.1, x0 - len, y0 - 0.12 + Math.sin(t * 12 + i) * 0.04); g.stroke();
  }
}
function horseDetail(g, o, k = 1) {
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  // bridle: cheekpiece, noseband, browband, the bit ring (leather and steel pick up the rim)
  g.strokeStyle = `rgba(255,110,70,${0.16 * k})`; g.lineWidth = 0.018;
  g.beginPath(); g.moveTo(0.06, 0.04); g.quadraticCurveTo(0.35, 0.40, 0.84, 0.75); g.stroke();
  g.beginPath(); g.moveTo(0.66, 0.36); g.quadraticCurveTo(0.62, 0.55, 0.72, 0.76); g.stroke();
  g.beginPath(); g.moveTo(0.08, 0.10); g.lineTo(0.20, 0.08); g.stroke();
  g.beginPath(); g.moveTo(0.10, 0.48); g.quadraticCurveTo(0.12, 0.30, 0.08, 0.06); g.stroke();   // throatlash
  g.strokeStyle = `rgba(255,225,190,${0.5 * k})`; g.lineWidth = 0.012;
  g.beginPath(); g.arc(0.86, 0.765, 0.035, 0, Math.PI * 2); g.stroke();
  // the eye: one hot catch-light and a lit lid
  g.fillStyle = `rgba(255,230,200,${0.95 * k})`; g.beginPath(); g.arc(0.305, 0.205, 0.011, 0, Math.PI * 2); g.fill();
  g.strokeStyle = `rgba(255,120,80,${0.45 * k})`; g.lineWidth = 0.01; g.beginPath(); g.arc(0.30, 0.215, 0.035, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  // the flared nostril, the jaw's big round muscle and the veins on the face take a faint rim
  g.strokeStyle = `rgba(255,140,90,${0.4 * k})`; g.lineWidth = 0.012;
  g.beginPath(); g.arc(0.935, 0.655, 0.035, -1.2, 2.2); g.stroke();
  g.strokeStyle = `rgba(255,110,70,${0.12 * k})`; g.lineWidth = 0.014;
  g.beginPath(); g.moveTo(0.18, 0.60); g.bezierCurveTo(0.26, 0.40, 0.46, 0.44, 0.54, 0.62); g.stroke();
  g.beginPath(); g.moveTo(0.42, 0.30); g.quadraticCurveTo(0.62, 0.46, 0.78, 0.52); g.stroke();
  g.restore();
}
// P: {x, y (poll), s (px per head length), face, phase (stride 0..1), t, tilt}
export function horse(g, P, sun, L = {}) {
  const bob = Math.sin((P.phase ?? 0) * Math.PI * 2) * 0.07;
  const tf = (m) => { m.translate(P.x, P.y); m.rotate((P.tilt ?? 0) + bob * P.face); m.scale(P.s * P.face, P.s); };
  lit(g, m => { tf(m); horseMask(m, P); }, sun, { cx: P.x, cy: P.y, ...L });
  g.save(); tf(g); horseDetail(g, P, L.detail ?? 1); g.restore();
  // snorted breath on the stride
  const nx = P.x + 0.99 * P.s * P.face, ny = P.y + 0.70 * P.s;
  breath(g, nx, ny, P.face, P.s * 0.6, (P.phase ?? 0), 0.9, 77);
}
export const horsePoint = (P, lx, ly) => {          // a point on the horse head (local units) in screen space
  const a = (P.tilt ?? 0) + Math.sin((P.phase ?? 0) * Math.PI * 2) * 0.07 * P.face, c = Math.cos(a), s = Math.sin(a);
  const x = lx * P.s * P.face, y = ly * P.s; return [P.x + x * c - y * s, P.y + x * s + y * c];
};

// ---------------------------------------------------------------- the crowd from behind: heads, hats, shoulders and fists against the light
function backFigure(g, o) {        // local unit = head height; origin at the base of the skull; y down
  const r = rng(o.seed), hat = o.hat, p = clamp(o.pump ?? 0.5);
  poly(g, [[-0.30, 0.10], [-0.36, -0.20], [-0.28, -0.52], [0, -0.62], [0.28, -0.52], [0.36, -0.20], [0.30, 0.10], [0.20, 0.30]]); g.fill();   // head from behind
  g.beginPath(); g.ellipse(-0.37, -0.10, 0.06, 0.12, 0.2, 0, Math.PI * 2); g.ellipse(0.37, -0.10, 0.06, 0.12, -0.2, 0, Math.PI * 2); g.fill();   // ears
  const sb = o.short ? 0.9 : 3.0;
  poly(g, [[-0.16, 0.2], [-0.5, 0.42], [-1.05, 0.58], [-1.2, 1.1], [-1.2, sb], [1.2, sb], [1.2, 1.1], [1.05, 0.58], [0.5, 0.42], [0.16, 0.2]]); g.fill();  // shoulders
  if (hat === 'hard') { poly(g, [[-0.44, -0.24], [-0.42, -0.55], [-0.2, -0.76], [0.2, -0.76], [0.42, -0.55], [0.44, -0.24]]); g.fill(); g.fillRect(-0.52, -0.28, 1.04, 0.07); }
  else if (hat === 'trucker' || hat === 'seed') { poly(g, [[-0.40, -0.26], [-0.40, -0.56], [-0.18, -0.74], [0.18, -0.74], [0.40, -0.56], [0.40, -0.26]]); g.fill(); }
  else if (hat === 'beanie') { poly(g, [[-0.38, -0.2], [-0.40, -0.54], [0, -0.74], [0.40, -0.54], [0.38, -0.2]]); g.fill(); }
  if (o.fist) {                    // an arm thrown up: sleeve, bare forearm, a clenched fist
    const side = r() < 0.5 ? -1 : 1, sx = side * 0.85, top = lerp(-1.1, -1.8, p);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = 0.52; g.beginPath(); g.moveTo(sx, 0.9); g.lineTo(sx + side * 0.28, -0.1); g.stroke();
    g.lineWidth = 0.36; g.beginPath(); g.moveTo(sx + side * 0.28, -0.1); g.lineTo(sx + side * 0.2, top + 0.3); g.stroke();
    poly(g, [[sx + side * 0.2 - 0.22, top + 0.32], [sx + side * 0.2 - 0.26, top + 0.02], [sx + side * 0.2 - 0.14, top - 0.16], [sx + side * 0.2 + 0.12, top - 0.18],
      [sx + side * 0.2 + 0.26, top - 0.02], [sx + side * 0.2 + 0.24, top + 0.30]]); g.fill();
  }
}
// rows: [{y, s, n, spread}] far to near. Everything above y0 is backlit from sun.
export function crowdBacks(g, rows, sun, t, pump = 0.5, seed = 95, L = {}) {
  const HATS = ['hard', 'trucker', 'seed', 'bare', 'hard', 'beanie', 'trucker'];
  lit(g, m => {
    const r = rng(seed);
    for (const row of rows) for (let i = 0; i < row.n; i++) {
      const x = lerp(-60, W + 60, (i + 0.5 + (r() - 0.5) * 0.6) / row.n), s = row.s * lerp(0.85, 1.15, r());
      const o = { seed: seed + i * 13 + row.y, hat: HATS[Math.floor(r() * HATS.length)], fist: r() < (row.fists ?? 0.5), pump: clamp(pump * lerp(0.6, 1.1, r()) + Math.sin(t * 8 + i) * 0.05) };
      m.save(); m.translate(x, row.y + Math.sin(t * 9 + i * 1.3) * row.s * 0.05 - (o.fist ? pump * row.s * 0.08 : 0)); m.rotate((r() - 0.5) * 0.1); m.scale(s, s); backFigure(m, o); m.restore();
    }
  }, sun, { cx: W / 2, cy: H * 0.8, rimW: 5, bloom: 26, ...L });
}

// ---------------------------------------------------------------- boots: a leg in denim and a lace-up work boot, in profile (unit: boot height; origin at the heel's ground point; toe +x)
function bootMask(g, lift, roll) {
  g.save(); g.translate(0, -lift); g.rotate(roll);
  poly(g, [[-0.22, 0.0], [0.12, 0.0], [0.20, -0.045], [0.36, 0.0], [1.02, 0.0], [1.13, -0.08], [1.09, -0.22], [0.86, -0.33], [0.56, -0.45],
    [0.41, -0.60], [0.35, -0.80], [0.37, -0.97], [0.26, -1.03], [-0.08, -1.01], [-0.15, -0.93], [-0.13, -0.72], [-0.23, -0.36], [-0.25, -0.08]]); g.fill();
  for (let i = 0; i < 10; i++) g.fillRect(-0.20 + i * 0.125 - (i > 2 ? 0 : 0), -0.01, 0.07, 0.055);                     // lugs
  poly(g, [[-0.16, -0.86], [-0.17, -1.6], [-0.22, -3.0], [-0.26, -6.0], [0.50, -6.0], [0.48, -3.0], [0.44, -1.6], [0.44, -0.80], [0.30, -0.74], [0.05, -0.78]]); g.fill();  // jeans, stacked on the collar
  g.restore();
}
function bootDetail(g, lift, roll, k) {
  g.save(); g.translate(0, -lift); g.rotate(roll); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  g.strokeStyle = `rgba(255,200,160,${0.5 * k})`; g.lineWidth = 0.02;
  for (let i = 0; i < 5; i++) { const y = -0.85 + i * 0.1; g.beginPath(); g.moveTo(0.28 - i * 0.0, y); g.lineTo(0.40 + i * 0.03, y + 0.05); g.stroke(); }  // laces / eyelets
  g.strokeStyle = `rgba(255,150,100,${0.35 * k})`; g.lineWidth = 0.016;
  g.beginPath(); g.moveTo(-0.2, -0.05); g.lineTo(1.08, -0.05); g.stroke();                          // the welt
  g.strokeStyle = `rgba(255,120,80,${0.28 * k})`; g.lineWidth = 0.02;
  g.beginPath(); g.moveTo(-0.17, -0.95); g.lineTo(-0.2, -3.2); g.lineTo(-0.25, -6); g.stroke();       // the outseam
  for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-0.16, -0.95 - i * 0.16); g.quadraticCurveTo(0.12, -0.86 - i * 0.2, 0.40, -0.98 - i * 0.14); g.stroke(); }   // stacked hem
  g.beginPath(); g.moveTo(0.70, -0.38); g.quadraticCurveTo(0.95, -0.30, 1.08, -0.12); g.stroke();   // toe cap
  g.restore();
}
// B: [{x, gy, s, lift 0..1, face}]
export function bootsRow(g, list, sun, L = {}) {
  lit(g, m => { for (const b of list) { m.save(); m.translate(b.x, b.gy); m.scale(b.s * b.face, b.s); bootMask(m, b.lift * 1.3, -b.lift * 0.35); m.restore(); } }, sun, { cx: W / 2, cy: H * 0.7, rimW: 6, bloom: 30, ...L });
  for (const b of list) { g.save(); g.translate(b.x, b.gy); g.scale(b.s * b.face, b.s); bootDetail(g, b.lift * 1.3, -b.lift * 0.35, L.detail ?? 1); g.restore(); }
}

// ---------------------------------------------------------------- light and air
export function sunDisc(g, x, y, r, hot = 1) {
  g.save(); g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(x, y, r * 0.2, x, y, r * 3.2);
  halo.addColorStop(0, `rgba(255,120,60,${0.75 * hot})`); halo.addColorStop(0.35, `rgba(220,30,20,${0.45 * hot})`); halo.addColorStop(1, 'rgba(90,0,0,0)');
  g.fillStyle = halo; g.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
  const disc = g.createRadialGradient(x, y, 0, x, y, r);
  disc.addColorStop(0, `rgba(255,236,205,${hot})`); disc.addColorStop(0.75, `rgba(255,170,110,${hot})`); disc.addColorStop(0.97, `rgba(255,90,50,${0.9 * hot})`); disc.addColorStop(1, 'rgba(255,60,30,0)');
  g.fillStyle = disc; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.restore();
}
export function dust(g, t, n = 160, seed = 7, a = 1, dir = -1, y0 = 0, y1 = H) {     // fine lit grit streaking past, plus soft plumes
  const r = rng(seed);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) {
    const y = lerp(y0, y1, r()), sp = lerp(300, 900, r()), x = ((r() * W * 2 + dir * t * sp) % (W + 900) + W + 900) % (W + 900) - 450, rr = lerp(120, 380, r());
    const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(255,80,45,${a * lerp(0.05, 0.14, r())})`); gr.addColorStop(1, 'rgba(255,40,20,0)');
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  for (let i = 0; i < n; i++) {
    const y = lerp(y0, y1, r()), sp = lerp(900, 3400, r()), x = ((r() * W * 3 + dir * t * sp) % (W + 200) + W + 200) % (W + 200) - 100;
    const len = lerp(6, 40, r()), al = a * lerp(0.15, 0.7, r());
    g.fillStyle = i % 3 ? `rgba(255,120,70,${al})` : `rgba(255,225,190,${al})`;
    g.fillRect(x, y, len, lerp(1.2, 2.6, r()));
  }
  g.restore();
}

// ---------------------------------------------------------------- an ensemble lit as one silhouette (a rider on his horse, the reins between)
// parts: [{kind: 'person'|'horse', P}] and optional reins: [[x0, y0], [x1, y1]] in screen space
export function ensemble(g, parts, sun, L = {}, reins = []) {
  const tfP = (m, P) => { m.translate(P.x, P.y); m.rotate(P.tilt ?? 0); m.scale(P.s * P.face, P.s); };
  const tfH = (m, P) => { m.translate(P.x, P.y); m.rotate((P.tilt ?? 0) + Math.sin((P.phase ?? 0) * Math.PI * 2) * 0.07 * P.face); m.scale(P.s * P.face, P.s); };
  lit(g, m => {
    for (const { kind, P } of parts) { m.save(); if (kind === 'horse') { tfH(m, P); horseMask(m, P); } else { tfP(m, P); personMask(m, P); } m.restore(); }
    m.lineCap = 'round';
    for (const [a, b2, w] of reins) { m.lineWidth = w ?? 7; m.beginPath(); m.moveTo(a[0], a[1]); m.quadraticCurveTo((a[0] + b2[0]) / 2, Math.max(a[1], b2[1]) + 40, b2[0], b2[1]); m.stroke(); }
  }, sun, L);
  for (const { kind, P } of parts) {
    g.save(); if (kind === 'horse') { tfH(g, P); horseDetail(g, P, L.detail ?? 1); } else { tfP(g, P); personDetail(g, P, L.detail ?? 1); } g.restore();
    if (kind === 'horse') breath(g, horsePoint(P, 0.99, 0.70)[0], horsePoint(P, 0.99, 0.70)[1], P.face, P.s * 0.6, (P.phase ?? 0), 0.9, 77);
    else if ((P.shout ?? 0) > 0.2) { const mo = rot([0.40, 0.27], PIVOT, (P.shout ?? 0) * 0.17); breath(g, P.x + mo[0] * P.s * P.face, P.y + mo[1] * P.s, P.face, P.s, (P.t ?? 0) * 1.3, P.shout, P.seed ?? 3); }
  }
}
export const personPoint = (P, lx, ly) => [P.x + lx * P.s * P.face, P.y + ly * P.s];

// ---------------------------------------------------------------- the cavalry: a whole horse at the gallop with its rider
// Horse units: withers height 1, ground at y 0, up is -y, faces +x. Four-beat transverse gallop keyed by phase p (0..1).
const LEGS = [      // [attach x, attach y, phase offset, fore?, far?]
  [-0.50, -0.64, 0.00, false, true], [-0.46, -0.62, 0.09, false, false],
  [0.40, -0.58, 0.44, true, true], [0.44, -0.58, 0.54, true, false]];
function legChain(p, fore) {        // segment angles from vertical (+ = forward) and lengths
  const st = fore ? 0.38 : 0.40;
  if (fore) {
    if (p < st) { const s = p / st; return [[lerp(0.38, -0.52, s), 0.27, 0.11], [lerp(0.38, -0.52, s), 0.21, 0.06], [lerp(0.38, -0.52, s) + 0.5 + 0.35 * Math.sin(Math.PI * s), 0.09, 0.05]]; }
    const s = (p - st) / (1 - st), a = lerp(-0.52, 0.38, 0.5 - 0.5 * Math.cos(Math.PI * s)) + 0.25 * Math.sin(Math.PI * s), f = Math.sin(Math.PI * Math.min(1, s * 1.3));
    return [[a + 0.15 * f, 0.27, 0.11], [a - 1.9 * f, 0.21, 0.06], [a - 1.9 * f - 0.6 * f + 0.5, 0.09, 0.05]];
  }
  if (p < st) { const s = p / st, a = lerp(0.50, -0.62, s); return [[a - 0.45, 0.33, 0.13], [a + 0.08, 0.25, 0.06], [a + 0.55 + 0.3 * Math.sin(Math.PI * s), 0.09, 0.05]]; }
  const s = (p - st) / (1 - st), a = lerp(-0.62, 0.50, 0.5 - 0.5 * Math.cos(Math.PI * s)), f = Math.sin(Math.PI * s);
  return [[a - 0.45 + 0.7 * f, 0.33, 0.13], [a + 0.08 - 0.6 * f, 0.25, 0.06], [a + 0.55 - 1.2 * f, 0.09, 0.05]];
}
function legPts(L, p) {
  const ch = legChain(((p + L[2]) % 1 + 1) % 1, L[3]); let x = L[0], y = L[1]; const pts = [[x, y, ch[0][2] * 1.2]];
  for (const [a, len, w] of ch) { x += Math.sin(a) * len; y += Math.cos(a) * len; pts.push([x, y, w]); }
  return { pts, ang: ch[2][0] };
}
function horseBody(g, o) {
  const p = o.phase ?? 0, t = o.t ?? 0, r = rng((o.seed ?? 1) + 60);
  // legs first (far ones included; everything is one silhouette)
  g.lineCap = 'round'; g.lineJoin = 'round';
  let minY = 0;
  const legs = LEGS.map(L => legPts(L, p));
  for (const { pts } of legs) for (const q of pts) minY = Math.max(minY, q[1]);
  const lift = minY - 0;                      // keep the lowest hoof on the ground (suspension: all four up)
  const air = Math.max(0, Math.sin(Math.PI * 2 * (p - 0.7))) * 0.05;
  g.save(); g.translate(0, -lift - air);
  const pitch = 0.05 * Math.sin(Math.PI * 2 * (p + 0.1));
  g.translate(0, -0.8); g.rotate(pitch); g.translate(0, 0.8);
  for (const { pts, ang } of legs) {
    for (let i = 0; i < pts.length - 1; i++) { g.lineWidth = pts[i][2]; g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke(); }
    const [hx, hy] = pts[pts.length - 1];     // the hoof
    g.save(); g.translate(hx, hy); g.rotate(-ang * 0.7); poly(g, [[-0.035, -0.02], [0.04, -0.03], [0.06, 0.045], [-0.04, 0.045]]); g.fill(); g.restore();
    g.beginPath(); g.arc(pts[1][0], pts[1][1], pts[1][2] * 0.62, 0, Math.PI * 2); g.fill();   // knee / hock
  }
  // barrel, chest, croup (the big masses)
  poly(g, [[0.60, -0.76], [0.57, -0.60], [0.44, -0.50], [0.18, -0.46], [-0.18, -0.49], [-0.44, -0.56], [-0.62, -0.60], [-0.80, -0.74],
    [-0.84, -0.90], [-0.74, -1.00], [-0.48, -1.03], [-0.22, -0.97], [0.04, -0.99], [0.24, -1.07], [0.40, -1.03]]); g.fill();
  poly(g, [[-0.40, -0.95], [-0.72, -0.94], [-0.66, -0.58], [-0.44, -0.52]]); g.fill();   // the hindquarter mass
  // the neck up to the head, stretched out at the gallop
  const nod = 0.06 * Math.sin(Math.PI * 2 * (p + 0.25));
  const poll = [0.98, -1.34 + nod];
  poly(g, [[0.16, -1.05], [0.44, -1.19], [0.72, -1.31], poll, [1.03, -1.24], [0.95, -1.12], [0.78, -0.96], [0.62, -0.74], [0.34, -0.74]]); g.fill();
  g.save(); g.translate(poll[0], poll[1]); g.rotate(0.30 + nod); g.scale(0.54, 0.54);
  horseMask(g, { ...o, seed: o.seed, phase: p, noNeck: true, crest: [-1.22, 0.93] });
  g.restore();
  // the tail streaming back
  for (let i = 0; i < 70; i++) {
    const len = lerp(0.35, 0.7, r()), wav = Math.sin(t * 9 + i * 0.5) * 0.06, a0 = lerp(-0.35, 0.25, r());
    g.lineWidth = lerp(0.006, 0.02, r());
    g.beginPath(); g.moveTo(-0.80, -0.92); g.quadraticCurveTo(-0.80 - len * 0.5, -0.94 + a0 * 0.3 + wav, -0.80 - len, -0.88 + a0 * len + wav * 1.5); g.stroke();
  }
  g.restore();
  return { lift: lift + air, pitch, poll };
}
// the rider seated at the withers, leaning into the charge
function riderOnHorse(g, o, U) {
  const p = o.phase ?? 0, sp = 0.205;                       // person head unit in horse units
  const hip = [0.02, -1.02 - 0.02 * Math.sin(Math.PI * 2 * (p + 0.3))];
  g.lineCap = 'round';
  g.lineWidth = 0.085; g.beginPath(); g.moveTo(hip[0], hip[1]); g.lineTo(0.24, -0.80); g.stroke();          // thigh
  g.lineWidth = 0.065; g.beginPath(); g.moveTo(0.24, -0.80); g.lineTo(0.14, -0.56); g.stroke();             // shin
  poly(g, [[0.10, -0.60], [0.22, -0.57], [0.26, -0.52], [0.10, -0.51]]); g.fill();                         // boot in the stirrup
  const lean = o.lean ?? 0.4;
  const hipL = [-0.2, 3.3], c = Math.cos(lean), s2 = Math.sin(lean);
  const hp = [hipL[0] * c - (hipL[1] - 0.6) * s2, 0.6 + hipL[0] * s2 + (hipL[1] - 0.6) * c];
  const ear = [hip[0] - hp[0] * sp, hip[1] - hp[1] * sp];
  g.save(); g.translate(ear[0], ear[1]); g.scale(sp, sp);
  personMask(g, { ...o, lean, tilt: 0 });
  if (o.banner) { g.lineWidth = 0.09; g.beginPath(); g.moveTo(0.1, 2.2); g.lineTo(0.9, -5.5); g.stroke(); }
  g.restore();
  return { ear, sp };
}
// riders: [{x, gy (ground y px), U (px per withers height), face, phase, t, seed, hat, beard, shout, pump, fist, banner}]
export function cavalry(g, riders, sun, L = {}) {
  const tf = (m, R) => { m.translate(R.x, R.gy); m.scale(R.U * R.face, R.U); };
  const info = [];
  lit(g, m => { for (const R of riders) { m.save(); tf(m, R); const hb = horseBody(m, R); m.translate(0, -hb.lift); const ri = riderOnHorse(m, R, R.U); m.restore(); info.push({ R, hb, ri }); } }, sun, L);
  for (const { R, hb, ri } of info) {
    // the banner: red cloth with the sun through it
    if (R.banner) {
      const sp = ri.sp, bx = ri.ear[0] + 0.9 * sp * 0.92, by = ri.ear[1] - 5.5 * sp + hb.lift * 0;
      g.save(); tf(g, R); g.translate(0, -hb.lift); g.globalCompositeOperation = 'lighter';
      const tt = R.t ?? 0; g.beginPath(); g.moveTo(bx, by);
      const Lb = 0.9, Hb = 0.42; const N = 12;
      for (let i = 0; i <= N; i++) { const u = i / N; g.lineTo(bx - u * Lb, by + Math.sin(tt * 9 - u * 5) * 0.05 * u); }
      for (let i = N; i >= 0; i--) { const u = i / N; g.lineTo(bx - u * Lb, by + Hb + Math.sin(tt * 9 - u * 5 + 0.4) * 0.07 * u + u * 0.05); }
      g.closePath(); const gr = g.createLinearGradient(bx, by, bx - Lb, by);
      gr.addColorStop(0, 'rgba(255,40,20,0.95)'); gr.addColorStop(1, 'rgba(200,10,10,0.6)'); g.fillStyle = gr; g.fill();
      g.save(); g.clip(); g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 9; i++) { const u = i / 9, x0 = bx - u * Lb, sh = 0.5 + 0.5 * Math.sin(tt * 9 - u * 5 + 1.2);
        const fg = g.createLinearGradient(x0, 0, x0 - Lb / 9, 0); fg.addColorStop(0, `rgba(60,0,0,${0.45 * sh})`); fg.addColorStop(0.5, `rgba(255,150,100,${0.25 * (1 - sh)})`); fg.addColorStop(1, `rgba(60,0,0,${0.45 * sh})`);
        g.fillStyle = fg; g.fillRect(x0 - Lb / 9, by - 0.2, Lb / 9, Hb + 0.4); }
      g.restore();
      g.restore();
    }
    // the eye and bit on the big ones, dust off the hooves
    if (R.U > 250) {
      g.save(); tf(g, R); g.translate(0, -hb.lift); g.translate(hb.poll[0], hb.poll[1]); g.rotate(0.30); g.scale(0.54, 0.54); horseDetail(g, R, 0.8); g.restore();
    }
    const r = rng((R.seed ?? 1) + 5), p = R.phase ?? 0;
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i++) {
      const a = ((p * 2 + i / 10) % 1), x = R.x - R.face * R.U * (lerp(-0.3, 0.9, r()) + a * 0.9), y = R.gy - R.U * (0.05 + a * 0.35 * r()), rr = R.U * lerp(0.12, 0.4, a);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(255,110,60,${0.28 * (1 - a) * (L.dust ?? 1)})`); gr.addColorStop(1, 'rgba(255,40,20,0)');
      g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    g.restore();
  }
}

// ---------------------------------------------------------------- the stomping crowd, full length from behind, from the dirt (unit: head height; origin on the ground between the feet)
function standing(g, o) {
  const lift = o.lift ?? 0, r = rng(o.seed), side = r() < 0.5 ? -1 : 1;
  for (const s of [-1, 1]) {                                // legs in denim and boots from behind; the stomping leg lifts at the knee
    const up = s === side ? lift * 0.5 : 0;
    g.save(); g.translate(s * 0.30, 0);
    poly(g, [[-0.27, -3.6], [-0.25, -2.0], [-0.20, -1.1 - up * 0.5], [-0.19, -0.35 - up], [-0.22, -0.02 - up], [0.22, -0.02 - up], [0.19, -0.35 - up], [0.21, -1.1 - up * 0.5], [0.27, -2.0], [0.29, -3.6]]); g.fill();
    g.fillRect(-0.23, -0.07 - up, 0.46, 0.08);
    g.restore();
  }
  poly(g, [[-0.62, -3.4], [-0.66, -4.4], [-0.95, -5.6], [-0.8, -5.95], [0.8, -5.95], [0.95, -5.6], [0.66, -4.4], [0.62, -3.4]]); g.fill();   // coat
  if (!o.fist) for (const s of [-1, 1]) { g.lineCap = 'round'; g.lineWidth = 0.28; g.beginPath(); g.moveTo(s * 0.9, -5.7); g.lineTo(s * 1.0, -4.6); g.lineTo(s * 0.92, -3.6); g.stroke(); }
  g.save(); g.translate(0, -6.3); g.scale(0.82, 0.82); backFigure(g, { seed: o.seed, hat: o.hat, fist: o.fist, pump: o.pump, short: true }); g.restore();
}
// rows: [{gy, h, n, fists}] far to near
export function stompers(g, rows, sun, t, lift, pump, seed = 400, L = {}) {
  const HATS = ['hard', 'trucker', 'seed', 'bare', 'hard', 'beanie', 'trucker'];
  lit(g, m => {
    const r = rng(seed);
    for (const row of rows) for (let i = 0; i < row.n; i++) {
      const x = lerp(-40, W + 40, (i + 0.5 + (r() - 0.5) * 0.7) / row.n), h = row.h * lerp(0.88, 1.12, r());
      const o = { seed: seed + i * 7 + row.n, hat: HATS[Math.floor(r() * HATS.length)], fist: r() < (row.fists ?? 0.4), pump: clamp(pump * lerp(0.7, 1.1, r())), lift: lift * lerp(0.7, 1, r()) };
      m.save(); m.translate(x, row.gy + (r() - 0.5) * row.h * 0.2); m.rotate((r() - 0.5) * 0.08 + Math.sin(t * 7 + i) * 0.015); m.scale(h * lerp(0.9, 1.2, r()), h); standing(m, o); m.restore();
    }
  }, sun, { cx: W / 2, cy: H * 0.6, rimW: 5, bloom: 24, ...L });
}
