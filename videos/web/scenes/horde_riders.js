// HORDE riders, cycle 1 of the HUMAN studio: the gallop is Muybridge's, the rider is a jointed cut-out.
// The horse is rotoscoped from Muybridge's 15-frame race-horse sequence (public domain; scripts/bake_muybridge.py):
// a real stride, where the legs gather under the body in the air instead of the rocking-horse spread of the old
// legChain() sine. The rider is built like Lotte Reiniger's figures (Prince Achmed, 1926): separate card parts
// (thigh, shin and boot, coat skirt, torso, head, upper arm, forearm, fist) pinned at the joints and posed per frame.
// The pose is driven by the photographs too: the seat rides on the traced back line, and the torso takes the bob and
// lean that the jockey's head actually made in each frame, smoothed and scaled to an upright horseman.
//
//   import { loadGallop, riderFrame, drawRider, drawHorse } from './horde_riders.js';
//   const G = await loadGallop();                               // assets/muybridge/gallop.json
//   const R = riderFrame(G, phase, { x, y, s, face, kind: 'flag' });   // phase 0..1 over a stride (15 frames)
//   lit(g, m => { drawHorse(m, G, R); drawRider(m, R); }, sun, L);   // horde_figures.js lit(): rim silhouette
// Cycle 2: four rider designs (P.design: 0 flat cap + long coat, 1 fur hat with ear flaps + cloak, 2 bareheaded
// with the hair streaming + banner, 3 hood + lowered lance with a pennant), no shakos or busbies; drawRider(g, R,
// { keyline }) strokes the whole rider's outline (print: a white keyline where riders overlap, as a woodcutter leaves
// between forms); drawHorde(g, G, t, { mode }) is the charge: 30-60 riders on four multiplane depths, each on its own
// phase and stride, a camera that travels with the pack (ground, grass and strata scroll at parallax speeds), contact
// shadows, dust kicked up at each hoof contact drifting back and up, and a sunlit dust wall behind the pack.
// Everything is a pure function of (phase, options).
const U = 390;                         // trace units per metre (the traced horse is ~2.4 m long, 940 units)
let _G = null;
export async function loadGallop(url = new URL('../assets/muybridge/gallop.json', import.meta.url).href) {
  if (_G) return _G;
  const J = await (await fetch(url)).json();
  const hy = J.frames.map(f => f.jockeyHead[1]), hx = J.frames.map(f => f.jockeyHead[0]);
  const my = hy.reduce((a, b) => a + b) / hy.length, mx = hx.reduce((a, b) => a + b) / hx.length;
  J.frames.forEach((f, i) => {
    f.path = new Path2D(); for (const p of f.polys) { f.path.moveTo(p[0][0], p[0][1]); for (let k = 1; k < p.length; k++) f.path.lineTo(p[k][0], p[k][1]); f.path.closePath(); }
    // the jockey's measured head motion about its mean, smoothed over neighbours (the photographs jitter a little)
    const nb = k => J.frames[(i + k + 15) % 15].jockeyHead;
    f.bob = ((nb(-1)[1] + 2 * f.jockeyHead[1] + nb(1)[1]) / 4 - my) / U;
    f.surge = ((nb(-1)[0] + 2 * f.jockeyHead[0] + nb(1)[0]) / 4 - mx) / U;
  });
  return (_G = J);
}

// ---------------------------------------------------------------- the cut-out parts (metres, joint at 0,0; limbs hang along +y)
const sp = (g, pts, closed = true) => {       // Catmull-Rom through pts
  const n = pts.length, P = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < (closed ? n : n - 1); i++) { const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), k = 1 / 6;
    g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]); }
  if (closed) g.closePath();
};
const PART = {
  // x forward (toward the horse's head), y down
  thigh: [[-0.075, -0.03], [0.06, -0.05], [0.085, 0.1], [0.07, 0.3], [0.06, 0.44], [0.0, 0.49], [-0.055, 0.44], [-0.07, 0.25], [-0.09, 0.08]],
  shin: [[-0.055, -0.03], [0.05, -0.04], [0.05, 0.2], [0.045, 0.36], [0.05, 0.41], [0.2, 0.43], [0.215, 0.47], [0.19, 0.5], [-0.06, 0.5], [-0.075, 0.44], [-0.055, 0.3], [-0.065, 0.12]],
  torso: [[-0.13, 0.04], [0.11, 0.05], [0.15, -0.08], [0.14, -0.22], [0.18, -0.37], [0.16, -0.5], [0.09, -0.58], [0.03, -0.64], [-0.06, -0.66], [-0.14, -0.58], [-0.17, -0.4], [-0.16, -0.2], [-0.17, -0.05]],
  skirt: [[-0.16, -0.06], [0.08, -0.02], [0.14, 0.16], [0.1, 0.3], [-0.05, 0.36], [-0.3, 0.34], [-0.42, 0.26], [-0.34, 0.12]],
  uarm: [[-0.055, -0.04], [0.055, -0.04], [0.06, 0.12], [0.05, 0.28], [0.0, 0.32], [-0.05, 0.28], [-0.06, 0.12]],
  farm: [[-0.045, -0.03], [0.05, -0.03], [0.05, 0.14], [0.04, 0.26], [-0.04, 0.26], [-0.05, 0.14]],
  fist: [[-0.04, -0.01], [0.045, -0.02], [0.06, 0.04], [0.055, 0.1], [0.0, 0.12], [-0.05, 0.1], [-0.055, 0.04]],
};
// the head in profile (facing +x): skull, brow, nose, lips, chin, jaw, a short beard, and a flat cap with a peak
const HEAD = [[-0.1, 0.02], [-0.11, -0.06], [-0.09, -0.15], [-0.03, -0.2], [0.04, -0.2], [0.085, -0.155], [0.095, -0.12], [0.1, -0.105], [0.125, -0.07], [0.135, -0.05],
  [0.112, -0.042], [0.108, -0.03], [0.118, -0.018], [0.108, -0.008], [0.112, 0.004], [0.1, 0.02], [0.09, 0.045], [0.06, 0.07], [0.0, 0.075], [-0.05, 0.06], [-0.06, 0.1], [-0.1, 0.09]];
const CAP = [[-0.118, -0.095], [-0.112, -0.17], [-0.06, -0.215], [0.03, -0.228], [0.13, -0.205], [0.175, -0.17], [0.2, -0.152], [0.185, -0.14], [0.11, -0.132], [0.0, -0.128], [-0.11, -0.085]];
const BEARD = [[0.1, 0.0], [0.105, 0.03], [0.08, 0.07], [0.03, 0.095], [-0.03, 0.085], [-0.07, 0.04], [-0.02, 0.05], [0.04, 0.045], [0.07, 0.02]];

// cycle 2 headwear and hair (head space, facing +x): a low fur hat with a back flap (never tall: no busby), a hood,
// and bare hair streaming back
const FUR = [[-0.14, 0.02], [-0.145, -0.08], [-0.13, -0.17], [-0.075, -0.235], [0.0, -0.255], [0.075, -0.24], [0.13, -0.19], [0.145, -0.14], [0.12, -0.125], [0.06, -0.14], [-0.02, -0.13], [-0.06, -0.09], [-0.075, -0.02], [-0.1, 0.04]];
const HOOD = [[-0.08, 0.16], [-0.16, 0.08], [-0.175, -0.06], [-0.13, -0.2], [-0.04, -0.265], [0.06, -0.25], [0.13, -0.18], [0.135, -0.11], [0.09, -0.155], [0.01, -0.165], [-0.05, -0.1], [-0.05, 0.0], [-0.02, 0.1]];
const HAIR = [[-0.1, 0.0], [-0.16, -0.04], [-0.24, -0.07], [-0.2, -0.11], [-0.26, -0.15], [-0.16, -0.17], [-0.09, -0.21], [0.0, -0.225], [0.07, -0.205], [0.1, -0.16], [0.07, -0.15], [-0.01, -0.16], [-0.06, -0.12], [-0.085, -0.06]];
const ragged = (pts, amp, seed) => pts.map(([x, y], i) => { const a = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; const n = (a - Math.floor(a)) - 0.5; return [x + n * amp, y + n * amp * 0.8]; });
let SHADE = null;           // set by drawRider({ shade }) for the lit pass: [dark, light] multipliers across each part
function part(g, name, x, y, a, s = 1, pts = PART[name]) {
  g.save(); g.translate(x, y); g.rotate(a); g.scale(s * U, s * U); g.beginPath(); sp(g, pts);
  if (SHADE && typeof g.fillStyle === 'string') { const base = g.fillStyle, gr = g.createLinearGradient(-0.09, 0, 0.09, 0); gr.addColorStop(0, shadeHex(base, SHADE[0])); gr.addColorStop(0.55, base); gr.addColorStop(1, shadeHex(base, SHADE[1])); g.fillStyle = gr; g.fill(); g.fillStyle = base; }
  else g.fill();
  g.restore();
}
const shadeHex = (hex, k) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * k)))); return `rgb(${c[0]},${c[1]},${c[2]})`; };
const end = (x, y, a, len) => [x - Math.sin(a) * len * U, y + Math.cos(a) * len * U];

// the pose for a stride phase: pure function. P: { x, y (ground line on screen), s (screen px per trace unit), face (+1 right / -1 left), kind: 'flag'|'fist'|'reins', seed }
export function riderFrame(G, phase, P = {}) {
  const n = G.frames.length, fi = ((Math.floor(phase * n) % n) + n) % n, F = G.frames[fi];
  const design = P.design ?? 0, kind = P.kind || (design === 3 ? 'lance' : design === 2 ? 'flag' : 'flag'), seed = P.seed ?? 1, ph = phase * Math.PI * 2;
  const pitch = F.pitch * Math.PI / 180;
  const seat = [F.saddle[0] - 0.02 * U, F.saddle[1] - 0.05 * U];
  // the upright horseman takes the photographed jockey's bob (compressing the torso) and surge (lean), damped
  const lean = 0.2 + pitch * 0.6 + F.surge * 1.2 + 0.03 * Math.sin(seed * 3.1);
  const comp = 1 - Math.max(-0.08, Math.min(0.08, F.bob * 0.9));
  const hip = [seat[0], seat[1] + F.bob * 0.25 * U];
  const thighA = -0.85 + 0.05 * Math.sin(ph + 1.2), knee = end(hip[0], hip[1], thighA, 0.44);
  const shinA = 0.18 + 0.05 * Math.sin(ph + 0.4);
  const neck = [hip[0] + Math.sin(lean) * 0.56 * U * comp, hip[1] - Math.cos(lean) * 0.56 * U * comp];
  const shoulder = [hip[0] + Math.sin(lean) * 0.5 * U * comp, hip[1] - Math.cos(lean) * 0.5 * U * comp];
  const lag = Math.sin(ph - 1.1);
  let uA, fA;
  if (kind === 'flag') { uA = Math.PI - 1.05 + 0.05 * lag; fA = Math.PI - 0.55 + 0.07 * lag; }
  else if (kind === 'fist') { uA = Math.PI - 0.7 + 0.12 * lag; fA = Math.PI - 0.25 + 0.15 * lag; }
  else if (kind === 'lance') { uA = 0.75 + 0.05 * lag; fA = 1.75 + 0.06 * lag; }      // the lance couched under the arm, lowered
  else { uA = 0.5 + 0.06 * lag; fA = 1.3 + 0.1 * lag; }
  const elbow = end(shoulder[0], shoulder[1], -uA, 0.3), wrist = end(elbow[0], elbow[1], -fA, 0.27);
  // the far arm holds the reins down to the bit
  const fuA = 0.35 + 0.05 * lag, ffA = 1.35 + 0.06 * lag, felbow = end(shoulder[0] - 0.03 * U, shoulder[1] + 0.01 * U, -fuA, 0.3), fwrist = end(felbow[0], felbow[1], -ffA, 0.27);
  return { F, fi, P: { x: 0, y: 0, s: 1, face: 1, ...P }, kind, design, hip, knee, thighA, shinA, lean, comp, neck, shoulder, elbow, wrist, uA, fA, ph, seed, fuA, ffA, felbow, fwrist,
    poleA: 0.42 + 0.05 * lag,
    headA: -lean * 0.7 + 0.08 + 0.03 * lag, skirtA: 0.1 * Math.sin(ph * 2 + 0.7) + 0.12 };
}

function frame(g, R) {       // trace space -> screen: the ground line sits on P.y, the horse centred on P.x
  const { P, F } = R; g.translate(P.x, P.y); g.scale(P.s * P.face, P.s); g.translate(-600, -F.ground);
}
export function drawHorse(g, G, R) { g.save(); frame(g, R); g.fill(R.F.path); g.restore(); }
// the horse with its own photographed modelling (Muybridge's frame, clipped to the traced outline), tinted
let _sheet = null;
export async function loadGallopPhoto(url = new URL('../assets/muybridge/gallop_photo.jpg', import.meta.url).href) {
  if (_sheet) return _sheet; _sheet = new Image(); _sheet.src = url; await _sheet.decode(); return _sheet;
}
export function drawHorsePhoto(g, R, { tint = '#6a3a20', gain = 1.0 } = {}) {
  if (!_sheet) return drawHorse(g, null, R);
  g.save(); frame(g, R); g.clip(R.F.path);
  const fi = R.fi, sx = (fi % 5) * 600, sy = Math.floor(fi / 5) * 400;
  g.fillStyle = tint; g.fillRect(0, 0, 1200, 800);
  g.globalCompositeOperation = 'multiply'; g.filter = `brightness(${2.6 * gain}) contrast(${1.3})`; g.drawImage(_sheet, sx, sy, 600, 400, 0, 0, 1200, 800);
  g.restore();
}
// cols (optional): fill per part { coat, trousers, boots, skin, cap, beard, pole } for the lit and print passes;
// without it every part takes the current fillStyle (a silhouette mask)
export function drawRider(g, R, { cols = null, shade = null, keyline = 0 } = {}) {
  if (keyline) return keylineRider(g, R, keyline);
  SHADE = shade; g.save(); frame(g, R);
  const D = R.design || 0, t = R.ph / (Math.PI * 2);
  const { hip, knee, thighA, shinA, lean, comp, neck, shoulder, elbow, wrist, uA, fA } = R;
  const c = k => { if (cols && cols[k]) { g.fillStyle = cols[k]; g.strokeStyle = cols[k]; } };
  // far arm and the reins (behind the torso)
  c('coat'); part(g, 'uarm', shoulder[0] - 0.03 * U, shoulder[1] + 0.01 * U, -R.fuA, 0.95); part(g, 'farm', R.felbow[0], R.felbow[1], -R.ffA, 0.95);
  c('skin'); part(g, 'fist', R.fwrist[0], R.fwrist[1], -R.ffA, 0.95);
  c('pole'); g.save(); g.lineWidth = 0.012 * U; g.beginPath(); g.moveTo(R.fwrist[0], R.fwrist[1] + 0.03 * U); const nose = R.F.nose; g.quadraticCurveTo((R.fwrist[0] + nose[0]) / 2, Math.max(R.fwrist[1], nose[1]) + 0.12 * U, nose[0] - 0.05 * U, nose[1] + 0.03 * U); g.stroke(); g.restore();
  if (D === 1) {          // the cloak: from the shoulders, streaming back and snapping in the wind of the gallop
    c('coat'); g.save(); const sx = shoulder[0], sy = shoulder[1], w1 = Math.sin(R.ph * 2 + R.seed) * 0.05 * U, w2 = Math.sin(R.ph * 2 + 1.3 + R.seed) * 0.07 * U;
    g.beginPath(); sp(g, [[sx + 0.04 * U, sy - 0.02 * U], [sx - 0.25 * U, sy + 0.02 * U + w1], [sx - 0.62 * U, sy + 0.12 * U + w2], [sx - 0.78 * U, sy + 0.3 * U + w1], [sx - 0.62 * U, sy + 0.4 * U + w2 * 0.5], [sx - 0.5 * U, sy + 0.34 * U], [sx - 0.36 * U, sy + 0.5 * U], [hip[0] - 0.12 * U, hip[1] + 0.02 * U], [hip[0] + 0.02 * U, hip[1] - 0.1 * U]]); g.fill(); g.restore();
  }
  c('coat'); part(g, 'skirt', hip[0], hip[1] - 0.04 * U, lean * 0.4 + R.skirtA, D === 2 ? 0.8 : 1);
  c('trousers'); part(g, 'thigh', hip[0], hip[1], thighA);
  c('boots'); part(g, 'shin', knee[0], knee[1], shinA);
  c('coat'); g.save(); g.translate(hip[0], hip[1]); g.rotate(lean); g.scale(U, U * comp); g.beginPath(); sp(g, PART.torso); g.fill(); g.restore();
  c('skin'); g.save(); g.translate(neck[0] - 0.02 * U, neck[1] + 0.02 * U); g.rotate(lean); g.fillRect(-0.05 * U, -0.14 * U, 0.1 * U, 0.16 * U); g.restore();   // neck
  g.save(); g.translate(neck[0] + 0.02 * U, neck[1] - 0.1 * U); g.rotate(R.headA + lean); g.scale(U * 1.22, U * 1.22);
  c('skin'); g.beginPath(); sp(g, HEAD); g.fill();
  if (D !== 3 && (R.seed % 3 !== 1 || D === 0)) { c('beard'); g.beginPath(); sp(g, BEARD); g.fill(); }
  c('cap'); g.beginPath();
  if (D === 0) sp(g, CAP); else if (D === 1) sp(g, ragged(FUR, 0.012, R.seed)); else if (D === 3) sp(g, HOOD);
  else { const w = Math.sin(R.ph * 2 + R.seed) * 0.02; sp(g, HAIR.map(([x, y]) => x < -0.1 ? [x - 0.02, y + w * (-x - 0.1) * 6] : [x, y])); }
  g.fill(); g.restore();
  c('coat'); part(g, 'uarm', shoulder[0], shoulder[1], -uA);
  part(g, 'farm', elbow[0], elbow[1], -fA);
  c('skin'); part(g, 'fist', wrist[0], wrist[1], -fA);
  if (R.kind === 'flag') {       // the pole in the fist, along the forearm, leaning back a little
    const rx = Math.sin(R.poleA), ry = -Math.cos(R.poleA);
    const top = [wrist[0] + rx * 1.6 * U, wrist[1] + ry * 1.6 * U], bot = [wrist[0] - rx * 0.3 * U, wrist[1] - ry * 0.3 * U];
    c('pole'); g.save(); g.lineWidth = 0.035 * U; g.lineCap = 'round'; g.beginPath(); g.moveTo(bot[0], bot[1]); g.lineTo(top[0], top[1]); g.stroke(); g.restore();
    R.flag = { top };
  } else if (R.kind === 'lance') {   // a lowered lance: long, forward, a pennant streaming back from under the tip
    const la = 1.2 + 0.03 * Math.sin(R.ph), rx = Math.sin(la), ry = -Math.cos(la);
    const top = [wrist[0] + rx * 2.2 * U, wrist[1] + ry * 2.2 * U], bot = [wrist[0] - rx * 0.9 * U, wrist[1] - ry * 0.9 * U];
    c('pole'); g.save(); g.lineWidth = 0.028 * U; g.lineCap = 'round'; g.beginPath(); g.moveTo(bot[0], bot[1]); g.lineTo(top[0], top[1]); g.stroke();
    const pb = [top[0] - rx * 0.12 * U, top[1] - ry * 0.12 * U], wv = Math.sin(R.ph * 3 + R.seed) * 0.04 * U;
    c('cap'); g.beginPath(); g.moveTo(pb[0], pb[1]); g.lineTo(pb[0] - rx * 0.28 * U, pb[1] - ry * 0.28 * U); g.lineTo(pb[0] - 0.42 * U, pb[1] + 0.12 * U + wv); g.closePath(); g.fill(); g.restore();
    R.flag = null;
  }
  g.restore(); SHADE = null;
}
// the flag cloth: a travelling wave down its length, streaming away from the direction of travel (drawn separately so
// a scene can colour it red over the silhouette)
export function drawFlag(g, R, t, { w = 1.1, h = 0.64, folds = false } = {}) {
  if (!R.flag) return; g.save(); frame(g, R);
  const [tx, ty] = R.flag.top, N = 24, top = [], bot = [], ph = t * 11 + R.seed;
  // two travelling waves (the cloth streams back and snaps), amplitude growing toward the fly, the fly end torn
  const wave = (u, k) => (Math.sin(u * 6.5 - ph) * 0.13 + Math.sin(u * 13 - ph * 1.7 + k) * 0.04) * Math.pow(u, 0.8) * U;
  for (let i = 0; i <= N; i++) { const u = i / N, droop = u * u * 0.1 * U, lagx = Math.sin(u * 6.5 - ph - 0.6) * 0.03 * u * U;
    top.push([tx - u * w * U + lagx, ty + wave(u, 0) + droop]); bot.push([tx - u * w * U * 0.97 + lagx, ty + h * U + wave(u, 1.3) * 1.2 + droop * 1.5]); }
  const fly = []; for (let k = 0; k <= 6; k++) { const v = k / 6, a = top[N], b = bot[N]; fly.push([a[0] + (b[0] - a[0]) * v - (k % 2 ? 0.05 : 0.0) * U * Math.sin(ph + k), a[1] + (b[1] - a[1]) * v]); }
  g.beginPath(); g.moveTo(top[0][0], top[0][1]); for (const p of top) g.lineTo(p[0], p[1]); for (const p of fly) g.lineTo(p[0], p[1]); for (let i = N; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]); g.closePath(); g.fill();
  if (folds) {       // light and shade across the folds: the slope of the wave
    g.save(); g.clip();
    const x0 = top[0][0], x1 = top[N][0], lg = g.createLinearGradient(x0, 0, x1, 0);
    for (let i = 0; i <= 40; i++) { const u = i / 40, sl = (Math.cos(u * 6.5 - ph) * 0.8 + Math.cos(u * 13 - ph * 1.7) * 0.3) * Math.pow(u, 0.5);
      lg.addColorStop(u, sl > 0 ? `rgba(255,200,160,${Math.min(0.5, 0.35 * sl)})` : `rgba(30,0,0,${Math.min(0.6, -0.45 * sl)})`); }
    g.fillStyle = lg; g.fillRect(Math.min(x0, x1) - 10, ty - 0.4 * U, Math.abs(x1 - x0) + 20, h * U + 0.8 * U);
    g.restore();
  }
  g.restore();
}
// screen-space points of the hooves on the ground this frame (for dust)
export function hoofContacts(R) { const { P, F } = R; return F.contacts.map(([u, v]) => [P.x + (u - 600) * P.s * P.face, P.y + (v - F.ground) * P.s]); }

// ---------------------------------------------------------------- cycle 2: keylines and the horde
// the rider's whole outline stroked `w` px wide (screen px) in the current strokeStyle: for print keylines, drawn first
// in paper colour so a rider in front is cut free of the ones behind (internal part edges are covered by the fill)
const KC = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function keylineRider(g, R, w) {
  const W0 = g.canvas.width, H0 = g.canvas.height; if (KC.width !== W0) { KC.width = W0; KC.height = H0; }
  const k = KC.getContext('2d'); k.setTransform(1, 0, 0, 1, 0, 0); k.clearRect(0, 0, W0, H0); k.fillStyle = '#000'; k.strokeStyle = '#000';
  drawHorse(k, null, R); drawRider(k, R); if (R.flag) drawFlag(k, R, R._t || 0);
  const col = g.strokeStyle; g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  const tc = keylineRider._t || (keylineRider._t = document.createElement('canvas')); if (tc.width !== W0) { tc.width = W0; tc.height = H0; }
  const tg = tc.getContext('2d'); tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'copy';
  for (let a = 0; a < 12; a++) { const dx = Math.cos(a / 12 * Math.PI * 2) * w, dy = Math.sin(a / 12 * Math.PI * 2) * w; tg.globalCompositeOperation = a ? 'source-over' : 'copy'; tg.drawImage(KC, dx, dy); }
  tg.globalCompositeOperation = 'source-in'; tg.fillStyle = col; tg.fillRect(0, 0, W0, H0);
  g.drawImage(tc, 0, 0); g.restore();
}
// a deterministic horde: [{ plane, x0, speed, P }], back to front. planes: far / mid / near / hero
export function hordeLayout({ n = 44, seed = 7, W = 1080, H = 1920, horizon = 0.53 } = {}) {
  let s = seed | 0; const r = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const hz = H * horizon, planes = [
    { name: 'far', n: Math.round(n * 0.6), y: [hz + 30, hz + 90], s: [0.1, 0.14], par: 0.25 },
    { name: 'mid', n: Math.round(n * 0.22), y: [hz + 150, hz + 260], s: [0.22, 0.3], par: 0.55 },
    { name: 'near', n: Math.max(3, n - Math.round(n * 0.6) - Math.round(n * 0.22) - 1), y: [hz + 420, hz + 560], s: [0.42, 0.52], par: 1 },
    { name: 'hero', n: 1, y: [H * 0.86, H * 0.86], s: [0.78, 0.78], par: 1.5 }];
  const out = [];
  for (const P of planes) for (let i = 0; i < P.n; i++) {
    const y = P.y[0] + (P.y[1] - P.y[0]) * (P.n > 1 ? (i % 3) / 2 * 0.6 + r() * 0.4 : 0), sc = P.s[0] + (P.s[1] - P.s[0]) * r();
    const design = P.name === 'hero' ? 0 : Math.floor(r() * 4), k = r(), kind = design === 3 ? 'lance' : design === 2 ? (k < 0.5 ? 'flag' : 'fist') : k < 0.4 ? 'fist' : k < 0.9 ? 'reins' : 'flag';
    out.push({ plane: P.name, par: P.par, x0: P.name === 'hero' ? W * 0.48 : (i + r() * 0.8) / P.n * (W + 900) - 450, speed: (r() - 0.5) * 60 * P.par, stride: 0.43 + r() * 0.07, off: r(),
      P: { y, s: sc, face: 1, design, kind: P.name === 'hero' ? 'flag' : kind, seed: 1 + Math.floor(r() * 997) } });
  }
  out.sort((a, b) => a.P.y - b.P.y);
  return out;
}
// the riders of the layout this frame (screen positions wrap so the pack is continuous as the camera travels)
export function hordeFrame(G, L, t, { W = 1080 } = {}) {
  return L.map(h => { const span = W + 900, x = h.plane === 'hero' ? h.x0 + Math.sin(t * 0.9) * 30 : ((h.x0 + h.speed * t) % span + span) % span - 450;
    const R = riderFrame(G, t / h.stride + h.off, { ...h.P, x }); R._t = t; R.h = h; return R; });
}
// dust puffs kicked at the hoof contacts of the last ~0.35 s: they stay where the hoof struck (the ground runs back at
// the travel speed), grow, rise and fade. Pure function of t.
export function hoofDust(G, h, t, travelPx, { n = 10, dt = 1 / 30 } = {}) {
  const out = [];
  for (let k = 1; k <= n; k++) { const tk = t - k * dt; const R = riderFrame(G, tk / h.stride + h.off, { ...h.P, x: 0 });
    if (!R.F.contacts.length) continue;
    const span = 1980, x0 = h.plane === 'hero' ? h.x0 + Math.sin(tk * 0.9) * 30 : ((h.x0 + h.speed * tk) % span + span) % span - 450;
    for (const [cx, cy] of hoofContacts({ ...R, P: { ...R.P, x: x0 } })) {
      const age = k * dt; out.push({ x: cx - travelPx * h.par * age * (h.P.face || 1), y: cy - 60 * h.P.s * age * 3, r: (8 + 90 * age) * h.P.s * 2, a: Math.max(0, 1 - age / (n * dt)) }); } }
  return out;
}
// the charge. mode 'rim' (the HORDE grammar: near-black cut-outs, crescent rims, sun behind), 'print' (key block +
// red block with keylines, for print.js), 'day' (the retired lit rider's replacement: flat cut-outs on a pale dusty sky).
// lit: horde_figures.js lit(); sunDisc, dust too (passed in to keep this module free of the scene's helpers).
// only: 'hero' draws the lone hero rider (the ONE shot); heroScale / heroX / heroY move and size him
export function drawHorde(g, G, t, { mode = 'rim', W = 1080, H = 1920, n = 44, seed = 7, horizon = 0.53, travel = 9, sun = null, lit, sunDisc, dust, only = null, heroScale = null, heroX = null, heroY = null } = {}) {
  const key = `${n}|${seed}|${horizon}|${W}|${H}`, L0 = drawHorde._L && drawHorde._k === key ? drawHorde._L : (drawHorde._k = key, drawHorde._L = hordeLayout({ n, seed, W, H, horizon }));
  const L = only ? L0.filter(h => h.plane === only).map(h => ({ ...h, x0: heroX ?? h.x0, P: { ...h.P, s: heroScale ?? h.P.s, y: heroY ?? h.P.y } })) : L0;
  const Rs = hordeFrame(G, L, t, { W }), hz = H * horizon, S = sun || [W * 0.36, hz - 170];
  const PX = 390 * 0.48;                                         // px per metre on the near plane
  const scroll = (par, spd) => ((t * travel * PX * par * spd) % 4000);
  const print = mode === 'print', day = mode === 'day';
  // sky, sun, far strata (a mesa line scrolling slowest)
  if (print) { g.fillStyle = '#f2ead8'; g.fillRect(0, 0, W, H); g.fillStyle = '#ee4a36'; g.beginPath(); g.arc(S[0], S[1], 260, 0, Math.PI * 2); g.fill(); }
  else { const gr = g.createLinearGradient(0, 0, 0, H); if (day) { gr.addColorStop(0, '#c9b28a'); gr.addColorStop(0.45, '#e2c79a'); gr.addColorStop(0.53, '#d89a5a'); gr.addColorStop(1, '#6a4028'); }
    else { gr.addColorStop(0, '#0a0508'); gr.addColorStop(0.45, '#3a0a06'); gr.addColorStop(0.53, '#7a2008'); gr.addColorStop(1, '#0e0403'); }
    g.fillStyle = gr; g.fillRect(0, 0, W, H); sunDisc(g, S[0], S[1], 230, day ? 0.6 : 1); }
  const inkFar = print ? '#6a6a6a' : day ? '#8a6040' : '#1a0806';
  g.save(); g.fillStyle = inkFar; g.beginPath(); g.moveTo(0, hz);
  for (let x = 0; x <= W; x += 12) { const u = (x + scroll(0.08, 1)) / 260; g.lineTo(x, hz - 18 - 22 * Math.max(0, Math.sin(u) * Math.sin(u * 0.37 + 1)) - 8 * Math.sin(u * 3.1)); }
  g.lineTo(W, hz); g.closePath(); g.fill(); g.restore();
  // the plain: bands and grass strokes that run back at parallax speeds (the camera travels with the pack)
  if (!print) { const gg = g.createLinearGradient(0, hz, 0, H); if (day) { gg.addColorStop(0, '#b07a48'); gg.addColorStop(1, '#4a2a18'); } else { gg.addColorStop(0, '#5a1806'); gg.addColorStop(0.4, '#2a0a04'); gg.addColorStop(1, '#0a0302'); } g.fillStyle = gg; g.fillRect(0, hz, W, H - hz); }
  g.save();
  for (let i = 0; i < 260; i++) { const a = Math.sin(i * 91.7) * 43758.5; const u = a - Math.floor(a), v = Math.pow((i + 0.5) / 260, 1.6), y = hz + 6 + v * (H - hz), par = 0.08 + v * 1.6;
    const x = ((u * 3000 - t * travel * PX * par) % (W + 200) + W + 200) % (W + 200) - 100, len = 4 + 60 * v * (0.5 + u);
    g.fillStyle = print ? '#2a2420' : day ? `rgba(70,40,20,${0.25 + 0.4 * v})` : `rgba(255,110,60,${0.05 + 0.18 * v})`; g.fillRect(x, y, len, 1 + 2.5 * v); }
  g.restore();
  // the dust wall behind the pack, lit by the sun
  if (!print) { g.save(); g.globalCompositeOperation = day ? 'source-over' : 'lighter';
    for (let i = 0; i < 26; i++) { const x = ((i * 97.3 + (i % 5) * 40 - t * travel * PX * 0.25) % (W + 400) + W + 400) % (W + 400) - 200, y = hz + 20 - (i % 4) * 30, rr = 160 + (i % 7) * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, day ? 'rgba(230,200,150,0.35)' : 'rgba(255,90,40,0.16)'); gr.addColorStop(1, 'rgba(255,60,20,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, 2 * rr, 2 * rr); }
    g.restore(); }
  // riders plane by plane, back to front: contact shadow, the rider, dust at the hooves
  const planes = ['far', 'mid', 'near', 'hero'];
  for (const pl of planes) {
    const RR = Rs.filter(R => R.h.plane === pl); if (!RR.length) continue;
    for (const R of RR) { const c = hoofContacts(R), gx = R.P.x, gy = R.P.y, w = 520 * R.P.s;     // the shadow under the horse, falling toward the camera
      g.save(); g.fillStyle = print ? 'rgba(30,24,20,0.28)' : day ? 'rgba(40,20,10,0.4)' : 'rgba(0,0,0,0.55)'; g.beginPath(); g.ellipse(gx, gy + 6 * R.P.s, w * (print ? 0.8 : 1), (print ? 18 : 34) * R.P.s + 3, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
    if (print) {
      for (const R of RR) { g.strokeStyle = '#f2ead8'; drawRider(g, R, { keyline: Math.max(2, 14 * R.P.s) });
        g.fillStyle = pl === 'far' ? '#4a4a4a' : '#141414'; g.strokeStyle = g.fillStyle; drawHorse(g, null, R); drawRider(g, R); g.fillStyle = '#ee4a36'; drawFlag(g, R, t); }
    } else {
      const rimL = day ? { rim: '#fff0d0', rim2: '#ffb070', body: '#241814', halo: 0.3, bloom: 14, rimW: 4 } : { rim: '#ffc79a', rim2: '#ff3a14', body: '#0a0203', halo: pl === 'far' ? 0.35 : pl === 'mid' ? 0.45 : 0.7, bloom: pl === 'far' ? 12 : pl === 'hero' ? 34 : 22, rimW: pl === 'far' ? 2 : pl === 'hero' ? 7 : 4, edge: pl === 'far' ? 0.5 : 0.25 };
      lit(g, m => { for (const R of RR) { drawHorse(m, null, R); drawRider(m, R); } }, S, rimL);
      for (const R of RR) if (R.flag) { g.save(); g.fillStyle = day ? '#b0140c' : '#c0140c'; drawFlag(g, R, t, { folds: pl !== 'far' }); if (!day) { g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,90,40,0.28)'; drawFlag(g, R, t); } g.restore(); }
    }
    // hoof dust (never glowing embers: dust is lit from behind, dim, and it drifts back)
    g.save(); if (!print && !day) g.globalCompositeOperation = 'lighter';
    for (const R of RR) for (const p of hoofDust(G, R.h, t, travel * PX)) { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      const col = print ? `rgba(60,50,44,${0.3 * p.a})` : day ? `rgba(200,160,110,${0.45 * p.a})` : `rgba(170,70,40,${0.2 * p.a})`; gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(p.x - p.r, p.y - p.r, 2 * p.r, 2 * p.r); }
    g.restore();
  }
  if (!print && dust) dust(g, t, 120, 5, day ? 0.3 : 0.6, -1, hz, H);
  if (print) { g.fillStyle = '#2a2420'; for (const pl of ['mid', 'near', 'hero']) { const R = Rs.find(q => q.h.plane === pl); if (R) g.fillRect(0, R.P.y + 3, W, pl === 'hero' ? 6 : 3); } }
  return { riders: Rs.length, planes: Object.fromEntries(planes.map(p => [p, Rs.filter(R => R.h.plane === p).length])), designs: [0, 1, 2, 3].map(d => Rs.filter(R => (R.design || 0) === d).length) };
}
