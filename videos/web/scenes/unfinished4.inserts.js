// 1776 / UNFINISHED v10 (scene unfinished4.js): the v9 inserts (copied from unfinished3.inserts.js), with the rubber stamp,
// the LIFE. LIBERTY. card and its broadside added (v12: its third line set as written, then struck, PRODUCTION. above it), and
// the words of hands() and rise() changed.
// v9 header:
// 1776 / SECOND INDEPENDENCE v9: the 2D inserts of the press cut (cycle-1 brief, videos/review/1776_c1/).
// Every human here is at crowd or poster scale, in silhouette or print (GRAPHICS_ROADMAP: no front-lit face at mid
// distance or closer): the three woodcut trade plates (Reference: 1770s broadside cuts), the square reading the
// broadside from behind, the Crown's seal snapping, the SAME WORDS split, the pen passed in candle silhouette, the
// Klutsis wall of raised hands (arms only), the press run of broadsides with the town stamp, the wax drop in the
// silence and the 2024 crowd getting to its feet. Type is always on paper: wood type multiplied into the stock.
import { W, H, C, clamp, lerp, ease, rng, acpEmblem } from '../lib/kit.js';
import { Print } from '../lib/fx/print.js';

export const pr = new Print({ ship: { boil: 0 } });
pr.preload(['ivory', 'cream', 'cotton']);
const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const WOODF = 'Anton';

// ================================================================ wood type, printed into the stock
// Condensed wood type (Anton), never squeezed: a long line breaks to a smaller size. The impression is multiplied
// into whatever paper is under it, with salt (starved ink), a darker squeezed rim and a faint deboss shadow.
const TY = mk(W + 400, 1100), gT = TY.getContext('2d');
export function woodtype(g, lines, cx, cy, { maxW = W - 140, em = 190, color = '#b3121c', rot = 0, age = 9, lh = 0.98, seed = 1, alpha = 1, each = false } = {}) {
  if (typeof lines === 'string') lines = [lines];
  gT.setTransform(1, 0, 0, 1, 0, 0); gT.clearRect(0, 0, TY.width, TY.height);
  gT.font = `${em}px "${WOODF}"`;
  const ws = lines.map(l => gT.measureText(l).width), wmax = Math.max(...ws);
  // each: every line fitted on its own (a broadside headline: the short word runs biggest); else one size for all
  const szs = each ? ws.map(w => Math.min(em, em * maxW / w)) : lines.map(() => wmax > maxW ? em * maxW / wmax : em);
  const sz = Math.max(...szs), tot = szs.reduce((a, v) => a + v * lh, 0), ox = TY.width / 2;
  gT.textAlign = 'center'; gT.fillStyle = color;
  let yy = TY.height / 2 - tot / 2;
  lines.forEach((l, i) => { yy += szs[i] * lh; gT.font = `${szs[i]}px "${WOODF}"`; gT.fillText(l, ox, yy - szs[i] * lh * 0.12); });
  const oy = TY.height / 2 - tot / 2 + sz * 0.86;
  const r = rng(seed * 97 + lines.join('').length);
  gT.globalCompositeOperation = 'destination-out';                  // salt: the wood grain starves the ink
  for (let i = 0; i < 520; i++) { gT.globalAlpha = 0.25 + r() * 0.6; gT.beginPath();
    gT.ellipse(ox + (r() - 0.5) * (maxW + 60), oy - sz + r() * (tot + sz * 0.3), 0.6 + r() ** 3 * 4, 0.5 + r() * 1.4, r() * 3, 0, 7); gT.fill(); }
  gT.globalAlpha = 0.18;
  for (let i = 0; i < 40; i++) { const y = oy - sz + r() * (tot + sz * 0.3); gT.fillRect(ox - maxW / 2, y, maxW, 0.8 + r() * 2); }   // grain streaks
  gT.globalAlpha = 1; gT.globalCompositeOperation = 'source-over';
  // struck: the hit frame already reads (the platen lands on the kick), a 2-frame settle from 106 %
  const a = ease.outExpo(clamp(age / 0.07)), sc = lerp(1.06, 1, a), base = g.globalAlpha;
  g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(sc, sc); g.globalAlpha = base * alpha * lerp(0.85, 1, a);
  g.globalCompositeOperation = 'multiply';
  g.filter = 'blur(2px)'; g.globalAlpha *= 0.35; g.drawImage(TY, -TY.width / 2 + 3, -TY.height / 2 + 4); g.filter = 'none';   // deboss shadow
  g.globalAlpha = base * alpha * lerp(0.85, 1, a); g.drawImage(TY, -TY.width / 2, -TY.height / 2);
  g.restore();
  return sz;
}

// ================================================================ silhouettes (figure units: 1 = standing height, y up is negative)
function capsule(g, a, b, ra, rb) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-3, an = Math.atan2(dy, dx);
  const e = Math.PI / 2 - Math.asin(clamp((ra - rb) / L, -0.9, 0.9));
  g.beginPath(); g.arc(a[0], a[1], ra, an + e, an - e + Math.PI * 2); g.arc(b[0], b[1], rb, an - e, an + e); g.closePath(); g.fill();
}
const P = (o, s, p) => [o[0] + p[0] * s, o[1] + p[1] * s];
// pose: head, neck, hip, and per side s (shoulder) e w (elbow, wrist), k a t (knee, ankle, toe); hat: brim | tricorn | round | cap
export function figure(g, pose, o, s, { hat = null, apron = false, coat = false, face = -1 } = {}) {
  const q = k => P(o, s, pose[k]);
  const S = v => v * s;
  for (const side of ['r', 'l']) {                                   // legs
    capsule(g, q('hip'), q(side + 'k'), S(0.064), S(0.046)); capsule(g, q(side + 'k'), q(side + 'a'), S(0.046), S(0.03));
    capsule(g, q(side + 'a'), q(side + 't'), S(0.032), S(0.02));
  }
  capsule(g, q('neck'), q('hip'), S(0.088), S(0.072));              // torso
  const nk = q('neck'), hp = q('hip');
  if (coat || apron) {                                              // coat skirts / leather apron, to the knees
    const kn = [(q('lk')[0] + q('rk')[0]) / 2, Math.max(q('lk')[1], q('rk')[1])], sp = Math.abs(q('lk')[0] - q('rk')[0]) * 0.5 + S(0.07);
    g.beginPath(); g.moveTo(hp[0] - S(0.08), hp[1] - S(apron ? 0.2 : 0.02)); g.lineTo(hp[0] + S(0.08), hp[1] - S(apron ? 0.2 : 0.02));
    g.lineTo(kn[0] + sp, kn[1] + S(apron ? 0.02 : -0.03)); g.quadraticCurveTo(kn[0], kn[1] + S(0.05), kn[0] - sp, kn[1] + S(apron ? 0.02 : -0.03)); g.closePath(); g.fill();
  }
  capsule(g, nk, q('head'), S(0.034), S(0.03));                     // neck
  for (const side of ['r', 'l']) {                                   // arms, fists
    capsule(g, q(side + 's'), q(side + 'e'), S(0.05), S(0.037)); capsule(g, q(side + 'e'), q(side + 'w'), S(0.037), S(0.027));
    const w = q(side + 'w'); g.beginPath(); g.ellipse(w[0], w[1], S(0.034), S(0.03), 0, 0, 7); g.fill();
  }
  const h = q('head'), tilt = pose.tilt || 0;
  g.save(); g.translate(h[0], h[1]); g.rotate(tilt);
  g.beginPath(); g.ellipse(0, 0, S(0.056), S(0.066), 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(face * S(0.05), S(0.018), S(0.018), S(0.012), 0, 0, 7); g.fill();   // nose/brow break in the profile
  if (hat === 'brim') { g.beginPath(); g.ellipse(0, -S(0.036), S(0.13), S(0.022), 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(0, -S(0.07), S(0.062), S(0.045), 0, Math.PI, 0); g.fill(); }
  if (hat === 'round') { g.beginPath(); g.ellipse(0, -S(0.042), S(0.1), S(0.02), 0, 0, 7); g.fill(); g.fillRect(-S(0.055), -S(0.1), S(0.11), S(0.06)); }
  if (hat === 'cap') { g.beginPath(); g.ellipse(-face * S(0.01), -S(0.045), S(0.068), S(0.045), 0, Math.PI, 0); g.fill(); }
  g.restore();
}

// ================================================================ the three trade plates (woodcut, two blocks: key + red sun)
const POSES = {
  farmer: { head: [-0.17, -0.88], neck: [-0.12, -0.79], hip: [0.0, -0.5], tilt: -0.2,
    rs: [-0.07, -0.76], re: [-0.02, -0.6], rw: [-0.12, -0.48], ls: [-0.12, -0.76], le: [-0.26, -0.58], lw: [-0.3, -0.36],
    lk: [-0.15, -0.27], la: [-0.2, -0.04], lt: [-0.28, -0.01], rk: [0.12, -0.26], ra: [0.21, -0.04], rt: [0.13, -0.01] },
  smith: { head: [0.06, -0.88], neck: [0.03, -0.8], hip: [0.0, -0.5], tilt: 0.12,
    rs: [-0.02, -0.78], re: [-0.1, -0.95], rw: [-0.08, -1.08], ls: [0.04, -0.78], le: [0.08, -0.96], lw: [-0.03, -1.1],
    lk: [0.12, -0.27], la: [0.14, -0.03], lt: [0.22, -0.01], rk: [-0.1, -0.26], ra: [-0.16, -0.03], rt: [-0.08, -0.01] },
  sailor: { head: [-0.15, -0.83], neck: [-0.12, -0.75], hip: [-0.02, -0.46], tilt: -0.25,
    rs: [-0.09, -0.73], re: [0.0, -0.8], rw: [0.13, -0.86], ls: [-0.13, -0.72], le: [-0.05, -0.71], lw: [0.04, -0.79],
    lk: [0.13, -0.24], la: [0.24, -0.03], lt: [0.31, -0.01], rk: [-0.06, -0.26], ra: [-0.13, -0.03], rt: [-0.05, -0.01] },
};
function plateSrc(kind) {
  const c = mk(), g = c.getContext('2d'), r = rng(kind.length * 131);
  const sun = { farmer: [560, 820, 360], smith: [360, 700, 330], sailor: [430, 760, 340] }[kind];
  const sky = g.createRadialGradient(sun[0], sun[1], sun[2] * 0.8, sun[0], sun[1], 1500);
  sky.addColorStop(0, '#f0ece4'); sky.addColorStop(0.35, '#b9b4ab'); sky.addColorStop(1, '#4a4642');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  if (kind === 'smith') {                                            // the forge mouth, the chimney hood, the firelight
    g.fillStyle = '#2a2826'; g.fillRect(0, 0, W, 330); g.beginPath(); g.moveTo(80, 330); g.lineTo(640, 330); g.lineTo(560, 470); g.lineTo(160, 470); g.fill();
    g.fillStyle = '#c21a1a'; g.beginPath(); g.arc(sun[0], sun[1], sun[2], 0, 7); g.fill();
    g.fillStyle = '#f4f0e8'; g.beginPath(); g.ellipse(sun[0], sun[1] + 150, 170, 90, 0, 0, 7); g.fill();   // white heat
  } else { g.fillStyle = '#c21a1a'; g.beginPath(); g.arc(sun[0], sun[1], sun[2], 0, 7); g.fill(); }
  // rays cut across the sky (the broadside cutter's sun)
  g.save(); g.globalCompositeOperation = 'source-over'; g.strokeStyle = 'rgba(40,36,34,0.55)';
  for (let i = 0; i < 26; i++) { const a = -Math.PI + i / 25 * Math.PI, w = 4 + (i % 2) * 5; g.lineWidth = w;
    g.beginPath(); g.moveTo(sun[0] + Math.cos(a) * (sun[2] + 30), sun[1] + Math.sin(a) * (sun[2] + 30)); g.lineTo(sun[0] + Math.cos(a) * 1400, sun[1] + Math.sin(a) * 1400); g.stroke(); }
  g.restore();
  const GY = 1470;                                                   // the ground
  g.fillStyle = '#1e1b19'; g.beginPath(); g.moveTo(0, GY - 20); g.quadraticCurveTo(W / 2, GY - 60, W, GY - 10); g.lineTo(W, H); g.lineTo(0, H); g.fill();
  g.fillStyle = '#0c0b0a';
  if (kind === 'farmer') {
    g.strokeStyle = '#0c0b0a'; g.lineCap = 'round';
    for (let i = 0; i < 420; i++) { const x = r() * W, y0 = GY - 10 + r() * 200, h = 90 + r() * 260, lean = (r() - 0.5) * 40;   // standing wheat
      g.lineWidth = 2 + r() * 3; g.beginPath(); g.moveTo(x, y0); g.quadraticCurveTo(x + lean * 0.3, y0 - h * 0.6, x + lean, y0 - h); g.stroke();
      g.beginPath(); g.ellipse(x + lean, y0 - h - 14, 6, 22, lean * 0.01, 0, 7); g.fill(); }
    const o = [600, GY + 30], s = 1080;
    figure(g, POSES.farmer, o, s, { hat: 'brim' });
    g.lineWidth = 16; g.beginPath(); g.moveTo(o[0] + 0.3 * s, o[1] - 0.82 * s); g.quadraticCurveTo(o[0] - 0.1 * s, o[1] - 0.52 * s, o[0] - 0.62 * s, o[1] - 0.12 * s); g.stroke();   // the snath
    g.lineWidth = 12; g.beginPath(); g.moveTo(o[0] - 0.14 * s, o[1] - 0.5 * s); g.lineTo(o[0] - 0.1 * s, o[1] - 0.44 * s); g.stroke();
    g.beginPath(); g.moveTo(o[0] - 0.62 * s, o[1] - 0.12 * s);                                                                    // the blade
    g.quadraticCurveTo(o[0] - 0.36 * s, o[1] - 0.02 * s, o[0] - 0.02 * s, o[1] - 0.07 * s); g.quadraticCurveTo(o[0] - 0.34 * s, o[1] - 0.07 * s, o[0] - 0.62 * s, o[1] - 0.16 * s); g.fill();
    for (let i = 0; i < 70; i++) { const x = r() * W, y0 = GY + 80 + r() * 300, h = 60 + r() * 140; g.lineWidth = 3 + r() * 4;   // mown swath in front
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (r() - 0.5) * 120, y0 - h * 0.3); g.stroke(); }
  } else if (kind === 'smith') {
    const o = [470, GY + 30], s = 1040;
    figure(g, POSES.smith, o, s, { apron: true, face: 1 });
    g.lineCap = 'round'; g.strokeStyle = '#0c0b0a'; g.lineWidth = 17;                                                              // the sledge
    const hx = o[0] - 0.055 * s, hy = o[1] - 1.09 * s, tx = o[0] - 0.3 * s, ty = o[1] - 1.3 * s;
    g.beginPath(); g.moveTo(hx + 0.04 * s, hy + 0.03 * s); g.lineTo(tx, ty); g.stroke();
    g.save(); g.translate(tx, ty); g.rotate(Math.atan2(ty - hy, tx - hx) + Math.PI / 2); g.fillRect(-70, -34, 140, 68); g.restore();
    g.beginPath(); g.moveTo(690, GY - 370); g.lineTo(1030, GY - 370); g.lineTo(1000, GY - 320); g.lineTo(930, GY - 300); g.lineTo(930, GY - 210);   // the anvil
    g.lineTo(990, GY - 150); g.lineTo(990, GY + 20); g.lineTo(770, GY + 20); g.lineTo(770, GY - 150); g.lineTo(820, GY - 210); g.lineTo(820, GY - 300);
    g.quadraticCurveTo(700, GY - 320, 600, GY - 355); g.closePath(); g.fill();
    g.fillStyle = '#f4f0e8';                                                                                                       // sparks off the iron
    for (let i = 0; i < 90; i++) { const a = -Math.PI * (0.1 + r() * 0.8), d = 30 + r() ** 2 * 520, x = 860 + Math.cos(a) * d, y = GY - 380 + Math.sin(a) * d * 0.8;
      g.save(); g.translate(x, y); g.rotate(a); g.fillRect(-(4 + r() * 16), -1.6, 8 + r() * 30, 3.2); g.restore(); }
    g.fillStyle = '#0c0b0a';
  } else {
    g.fillRect(860, 0, 34, GY);                                                                                                    // the mast, to one side
    g.fillRect(640, 260, 440, 18);                                                                                                 // a yard
    g.strokeStyle = '#0c0b0a'; g.lineCap = 'round';
    for (const [x0, y0, x1, y1, w] of [[877, 40, 1080, 900, 5], [877, 260, 1080, 1300, 4], [877, 120, 1060, 1420, 3]]) {        // shrouds, clear of the figure
      g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    g.fillRect(0, GY - 40, W, 24);                                                                                                 // the rail
    const o = [470, GY + 30], s = 1060;
    figure(g, POSES.sailor, o, s, { hat: 'round', face: 1 });
    g.lineWidth = 11; g.beginPath(); g.moveTo(o[0] + 0.14 * s, o[1] - 0.86 * s); g.lineTo(862, 300); g.stroke();                  // the fall, hauled
    g.beginPath(); g.moveTo(o[0] + 0.04 * s, o[1] - 0.79 * s); g.quadraticCurveTo(o[0] - 0.2 * s, o[1] - 0.6 * s, o[0] - 0.35 * s, o[1] - 0.02 * s); g.stroke();
  }
  return c;
}
const PLATES = {};
function plate(kind, t) {
  if (!PLATES[kind]) {
    const c = mk(); pr.render(null, plateSrc(kind), [['woodcut', { two: 1, t1: 0.26, t2: 0.7, pitch: 12, jag: 0.7, chisel: 0.6, angle: 0.25, ink: 'carbon', ink2: 'acp', off2: [4, -3] }]],
      { t: 0, paper: 'ivory', levels: [0, 1, 1], prep: { simplify: 6, boost: 0.3, clear: 0.2 } });
    pr.draw(c.getContext('2d')); PLATES[kind] = c;
  }
  return PLATES[kind];
}
// FARMERS. (2-4) / MECHANICS. (4-5) / SAILORS. (5-7): a plate a phrase, a slow push, the word cut below the block
export function plates(ctx, beat, spb) {
  const [kind, b0, word] = beat < 4 ? ['farmer', 2, 'FARMERS.'] : beat < 5 ? ['smith', 4, 'MECHANICS.'] : ['sailor', 5, 'SAILORS.'];
  const u = beat - b0, z = 1.04 + u * 0.025, im = plate(kind);
  const slam = Math.exp(-u * spb * 22);
  ctx.save(); ctx.translate(W / 2, H * 0.42); ctx.scale(z, z); ctx.translate(-W / 2 + slam * 10, -H * 0.42);
  ctx.drawImage(im, 0, 0); ctx.restore();
  // the text block under the cut: a paper band with a black rule, the word in wood type
  ctx.fillStyle = '#f1e7d2'; ctx.fillRect(0, 1560, W, 360);
  ctx.fillStyle = '#16130f'; ctx.fillRect(56, 1582, W - 112, 7); ctx.fillRect(56, 1596, W - 112, 2);
  woodtype(ctx, word, W / 2, 1735, { em: 190, maxW: W - 150, color: kind === 'smith' ? '#b3121c' : '#18130f', age: u * spb, seed: b0 });
}

// ================================================================ crowds from behind (1776 square, 2024 hall)
function backOf(g, x, y, s, kind, r) {                               // one person seen from behind: head, hat, shoulders
  const sw = s * (0.36 + r() * 0.1), sh = s * (0.1 + r() * 0.04), tilt = (r() - 0.5) * 0.12;
  g.save(); g.translate(x, y); g.rotate(tilt);
  g.beginPath(); g.moveTo(-sw, s * 0.9); g.lineTo(-sw, sh + s * 0.08); g.quadraticCurveTo(-sw, sh - s * 0.02, -sw * 0.55, sh - s * 0.05);
  g.quadraticCurveTo(0, sh - s * 0.12, sw * 0.55, sh - s * 0.05); g.quadraticCurveTo(sw, sh - s * 0.02, sw, sh + s * 0.08); g.lineTo(sw, s * 0.9); g.fill();
  g.fillRect(-s * 0.05, -s * 0.05, s * 0.1, s * 0.12);
  g.beginPath(); g.ellipse(0, -s * 0.1, s * 0.078, s * 0.095, 0, 0, 7); g.fill();
  if (kind === 'tricorn') { g.beginPath(); g.moveTo(-s * 0.16, -s * 0.12); g.quadraticCurveTo(0, -s * 0.28, s * 0.16, -s * 0.12); g.quadraticCurveTo(0, -s * 0.16, -s * 0.16, -s * 0.12); g.fill(); }
  else if (kind === 'bonnet') { g.beginPath(); g.ellipse(0, -s * 0.11, s * 0.1, s * 0.11, 0, 0, 7); g.fill(); }
  else if (kind === 'queue') g.fillRect(-s * 0.012, -s * 0.03, s * 0.024, s * 0.12);
  else if (kind === 'brim') { g.beginPath(); g.ellipse(0, -s * 0.15, s * 0.15, s * 0.03, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(0, -s * 0.18, s * 0.07, s * 0.05, 0, Math.PI, 0); g.fill(); }
  else if (kind === 'hardhat') { g.beginPath(); g.ellipse(0, -s * 0.14, s * 0.11, s * 0.085, 0, Math.PI, 0); g.fill(); g.fillRect(-s * 0.125, -s * 0.15, s * 0.25, s * 0.03); }
  else if (kind === 'ballcap') { g.beginPath(); g.ellipse(0, -s * 0.13, s * 0.085, s * 0.07, 0, Math.PI, 0); g.fill(); }
  else if (kind === 'hood') { g.beginPath(); g.ellipse(0, -s * 0.08, s * 0.11, s * 0.13, 0, 0, 7); g.fill(); }
  g.restore();
}
const ERA = { 1776: ['tricorn', 'tricorn', 'bonnet', 'queue', 'brim', 'tricorn', 'bare'], 2024: ['hardhat', 'ballcap', 'bare', 'hood', 'ballcap', 'hardhat', 'bare', 'bonnet'] };
const CROWD = mk(), gC = CROWD.getContext('2d'), RIM = mk(), gRi = RIM.getContext('2d');
function crowd(g, era, { seed = 7, rows = 7, y0 = 1180, y1 = 1900, s0 = 90, s1 = 420, rise = 1, light = [540, 600], rimCol = '#ffb35a', base = '#0d0908', stagger = 0 }) {
  gC.clearRect(0, 0, W, H); gRi.clearRect(0, 0, W, H);
  const r = rng(seed);
  for (let j = 0; j < rows; j++) {
    const k = j / (rows - 1), s = lerp(s0, s1, k ** 1.6), y = lerp(y0, y1, k ** 1.3), n = Math.ceil(W / (s * 0.62)) + 2;
    const haze = (1 - k) * 0.55;
    for (let i = 0; i < n; i++) {
      const x = (i + (j % 2) * 0.5 + (r() - 0.5) * 0.4) * s * 0.62 - s * 0.3, kind = ERA[era][Math.floor(r() * ERA[era].length)];
      const up = clamp((rise - stagger * r()) / Math.max(0.001, 1 - stagger)), yy = y + (1 - ease.outCubic(up)) * s * 0.55 + (r() - 0.5) * s * 0.1;
      const dx = (x - light[0]) / 900, dy = (yy - light[1]) / 900, dl = Math.hypot(dx, dy) || 1;
      gRi.fillStyle = rimCol; backOf(gRi, x - dx / dl * s * 0.035, yy - dy / dl * s * 0.035, s, kind, rng(seed * 1000 + j * 50 + i));
      gC.fillStyle = `rgb(${lerp(13, 70, haze)},${lerp(9, 48, haze)},${lerp(8, 36, haze)})`; backOf(gC, x, yy, s, kind, rng(seed * 1000 + j * 50 + i));
      gRi.fillStyle = gC.fillStyle; backOf(gRi, x, yy, s, kind, rng(seed * 1000 + j * 50 + i));
    }
  }
  g.drawImage(RIM, 0, 0);
}
function torch(g, x, y, t, k = 1) {
  const f = 0.85 + 0.1 * Math.sin(t * 23 + x) + 0.05 * Math.sin(t * 51);
  const gr = g.createRadialGradient(x, y, 0, x, y, 520 * k * f); gr.addColorStop(0, 'rgba(255,196,110,0.9)'); gr.addColorStop(0.15, 'rgba(255,140,50,0.45)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(x - 600, y - 600, 1200, 1200); g.restore();
  g.fillStyle = '#fff1c8'; g.beginPath(); g.ellipse(x, y - 8, 16 * k, 40 * k * f, 0, 0, 7); g.fill();
}
function broadsideSheet(g, cx, cy, w, h, rot, head, { small = null, t = 0, lit = 1, emblem = false, headColor = '#18130f', panel = null, age = 9 } = {}) {
  g.save(); g.translate(cx, cy); g.rotate(rot);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-w / 2 + 12, -h / 2 + 16, w, h);
  const pg = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); pg.addColorStop(0, `rgb(${238 * lit | 0},${224 * lit | 0},${192 * lit | 0})`); pg.addColorStop(1, `rgb(${206 * lit | 0},${184 * lit | 0},${146 * lit | 0})`);
  g.fillStyle = pg; g.fillRect(-w / 2, -h / 2, w, h);
  const r = rng(Math.round(w + h)); g.fillStyle = 'rgba(120,80,40,0.08)';
  for (let i = 0; i < 200; i++) g.fillRect(-w / 2 + r() * w, -h / 2 + r() * h, 1 + r() * 3, 1 + r() * 3);
  g.fillStyle = '#18130f'; g.fillRect(-w / 2 + w * 0.06, -h / 2 + h * 0.07, w * 0.88, h * 0.008); g.fillRect(-w / 2 + w * 0.06, -h / 2 + h * 0.085, w * 0.88, h * 0.003);
  g.font = `${Math.round(w * 0.04)}px "IM Fell English SC"`; g.textAlign = 'center';
  g.fillText(small || 'In Congress, July 4, 1776.', 0, -h / 2 + h * 0.06);
  woodtype(g, head, 0, -h / 2 + h * 0.3, { em: w * 0.22, maxW: w * 0.88, color: headColor, age, seed: head.length, each: true });
  g.fillStyle = '#18130f'; g.fillRect(-w / 2 + w * 0.06, -h / 2 + h * 0.52, w * 0.88, h * 0.004);
  g.globalAlpha = 0.55; g.fillStyle = '#2a1f16';                                                   // body text, too small to read
  for (let i = 0; i < 16; i++) { const lw = w * (0.8 - (i % 5 === 4 ? 0.3 : 0.02 * (i % 3))); g.fillRect(-lw / 2, -h / 2 + h * (0.56 + i * 0.022), lw, h * 0.008); }
  g.globalAlpha = 1;
  if (emblem) acpEmblem(g, 0, h * 0.35, h * 0.09, { color: '#18130f' });
  if (panel) panel(g, w, h);
  g.restore();
}
// A PEOPLE'S REVOLUTION. (7-9): the broadside posted up in the square at night, read to the crowd; we stand behind them
export function square(ctx, beat, t, spb) {
  const u = beat - 7;
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#120b08'); bg.addColorStop(1, '#2a160c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1d110b';                                                                         // the brick wall
  for (let y = 0; y < 1300; y += 44) for (let x = ((y / 44) % 2) * 45 - 45; x < W; x += 90) ctx.fillRect(x + 3, y + 3, 84, 38);
  const z = 1 + u * 0.03;
  ctx.save(); ctx.translate(W / 2, 560); ctx.scale(z, z); ctx.translate(-W / 2, -560);
  broadsideSheet(ctx, W / 2, 540, 700, 860, -0.018, ["A PEOPLE'S", 'REVOLUTION.'], { age: u * spb, headColor: '#18130f' });
  ctx.restore();
  const lg = ctx.createRadialGradient(W / 2, 540, 100, W / 2, 540, 900); lg.addColorStop(0, 'rgba(255,170,80,0.0)'); lg.addColorStop(1, 'rgba(20,6,2,0.7)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
  torch(ctx, 90, 980, t, 1.1); torch(ctx, 1000, 930, t, 0.9);
  crowd(ctx, 1776, { seed: 17, rows: 6, y0: 1080, y1: 1640, s0: 150, s1: 560, light: [540, 540], rimCol: '#ffae5e' });
}
// ON YOUR FEET. (46-48): a union hall, the broadside on the far wall; the rows stand up, back to front, on the roll
export function rise(ctx, beat, t, spb) {
  const u = beat - 46;
  ctx.fillStyle = '#0c0a0b'; ctx.fillRect(0, 0, W, H);
  const hl = ctx.createRadialGradient(W / 2, 600, 50, W / 2, 600, 1000); hl.addColorStop(0, 'rgba(250,236,210,0.35)'); hl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hl; ctx.fillRect(0, 0, W, H);
  broadsideSheet(ctx, W / 2, 540, 700, 860, 0.012, ['THE WORKING', 'CLASS'], { small: 'American Communist Party', age: u * spb, headColor: '#b3121c', emblem: true });
  crowd(ctx, 2024, { seed: 46, rows: 6, y0: 1060, y1: 1640, s0: 140, s1: 560, rise: ease.inOutCubic(clamp(u / 1.6)), stagger: 0.6, light: [540, 620], rimCol: '#f4e6d0' });
}

// ================================================================ the Crown's seal snaps (9-10.5)
export function crown(ctx, beat, t, spb, S) {                          // S: { paper, seal (pressed crown seal canvas) }
  const u = beat - 9, snap = ease.outExpo(clamp(u / 0.35)), z = 1.25 - u * 0.05;
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.rotate(0.05);
  ctx.drawImage(S.paper, 180, 300, 720, 1280, -W / 2, -H / 2, W, H * 1.0);
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#d8c8a8'; ctx.fillRect(-W, -H, W * 2, H * 2); ctx.globalCompositeOperation = 'source-over';
  ctx.font = '44px "IM Fell English"'; ctx.fillStyle = 'rgba(30,18,10,0.75)'; ctx.textAlign = 'center';
  ctx.fillText('By the KING.', 0, -560); ctx.font = '30px "IM Fell English"';
  ['A PROCLAMATION,', 'For suppressing Rebellion and Sedition.'].forEach((s, i) => ctx.fillText(s, 0, -505 + i * 40));
  const R = 330, cx = 0, cy = -60, crack = [[-R * 1.2, -40], [-150, -10], [-90, 30], [-20, -25], [40, 20], [110, -12], [170, 25], [R * 1.2, 0]];
  const halves = [[crack, -1], [crack, 1]];
  for (const [cr, side] of halves) {
    ctx.save();
    const dx = side * snap * 95, dy = side * snap * 30 + snap * 20, rot = side * snap * 0.22;
    ctx.translate(cx + dx, cy + dy); ctx.rotate(rot);
    ctx.beginPath(); ctx.moveTo(cr[0][0], side < 0 ? -R * 1.3 : R * 1.3); cr.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(cr[cr.length - 1][0], side < 0 ? -R * 1.3 : R * 1.3); ctx.closePath();
    ctx.clip();
    ctx.shadowColor = 'rgba(20,4,2,0.6)'; ctx.shadowBlur = 30; ctx.shadowOffsetX = 14; ctx.shadowOffsetY = 20;
    ctx.drawImage(S.seal, -R, -R, R * 2, R * 2);
    ctx.restore();
  }
  const r = rng(99);                                                   // chips of wax flying off the break
  ctx.fillStyle = '#5a0a0e';
  for (let i = 0; i < 26; i++) { const a = (r() - 0.5) * 2.4 + (r() < 0.5 ? 0 : Math.PI), v = 200 + r() * 700, x = cx + Math.cos(a) * v * snap, y = cy + Math.sin(a) * v * snap * 0.6 + snap * snap * 120;
    if (u > 0.02) { ctx.beginPath(); ctx.ellipse(x, y, 4 + r() * 12, 3 + r() * 8, r() * 3, 0, 7); ctx.fill(); } }
  ctx.restore();
  const lg = ctx.createLinearGradient(0, 0, W, H); lg.addColorStop(0, 'rgba(255,190,110,0.12)'); lg.addColorStop(1, 'rgba(10,3,0,0.55)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
  woodtype(ctx, 'BROKE AN EMPIRE.', W / 2, 1560, { em: 170, maxW: W - 140, color: '#18130f', age: u * spb, seed: 9, rot: -0.02 });
}

// ================================================================ SAME WORDS. (21-23): the two lines in register, warm over cold
export function split(ctx, beat, spb, S) {                             // S: { s1, s2 (sheet canvases, px = units*PS), PS, first, echo }
  const u = beat - 21, PS = S.PS;
  const put = (src, it, y0, h, tint, drift) => {
    const L = it.left + it.ox / PS - 30, w = it.tw / PS + 60, base = it.top + it.oy / PS, top = base - h * 0.62;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, h * (W / w)); ctx.clip();
    const s = W / w, dx = drift * u * 14;
    ctx.drawImage(src, L * PS + dx, top * PS, w * PS, h * PS, 0, y0, W, h * s);
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = tint; ctx.fillRect(0, y0, W, h * s);
    ctx.restore(); return y0 + h * s;
  };
  ctx.fillStyle = '#101010'; ctx.fillRect(0, 0, W, H);
  // the 1776 line in the top half (warm, candle), the 2024 line in the bottom half (cold, daylight), in register
  const half = (src, it, y0, tint, drift) => {
    const L = it.left + it.ox / PS - 40, w = it.tw / PS + 80, sc = W / w, hU = 800 / sc, base = it.top + it.oy / PS;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, 800); ctx.clip();
    ctx.drawImage(src, (L + drift * u * 10) * PS, (base - hU * 0.62) * PS, w * PS, hU * PS, 0, y0, W, 800);
    ctx.globalCompositeOperation = 'multiply'; const gr = ctx.createLinearGradient(0, y0, 0, y0 + 800);
    gr.addColorStop(0, '#5a4a3a'); gr.addColorStop(0.45, tint); gr.addColorStop(0.75, tint); gr.addColorStop(1, '#4a4038'); ctx.fillStyle = gr; ctx.fillRect(0, y0, W, 800);
    ctx.restore();
    ctx.fillStyle = '#b3121c'; ctx.fillRect(60, y0 + 800 * 0.62 + 16, W - 120, 7);                   // the line underscored
  };
  half(S.s1, S.first, 0, '#ffd9a0', 1);
  half(S.s2, S.echo, 1120, '#c4d2e6', -1);
  ctx.font = '40px "IM Fell English SC"'; ctx.textAlign = 'left'; ctx.fillStyle = '#f3dcb2'; ctx.fillText('1776', 60, 80);
  ctx.fillStyle = '#dbe6f4'; ctx.fillText('2024', 60, 1190);
  const pg = ctx.createLinearGradient(0, 800, 0, 1120); pg.addColorStop(0, '#efe5d0'); pg.addColorStop(1, '#d8cbb0');
  ctx.fillStyle = pg; ctx.fillRect(0, 800, W, 320);
  woodtype(ctx, 'SAME WORDS.', W / 2, 960, { em: 200, maxW: W - 140, color: '#18130f', age: u * spb, seed: 21 });
}

// ================================================================ PASS THE PEN. (26-28): two hands in candle silhouette, a quill between
function hand(g, wx, wy, dir, s, curl, sleeve) {                      // dir: pointing angle of the hand; curl 0 open .. 1 closed (a pinch)
  g.save(); g.translate(wx, wy); g.rotate(dir);
  g.fillStyle = '#070404';
  g.beginPath(); g.moveTo(-s * 1.9, -s * 0.3); g.lineTo(0, -s * 0.24); g.lineTo(0, s * 0.26); g.lineTo(-s * 1.9, s * 0.36); g.fill();   // forearm
  if (sleeve) { g.beginPath(); g.moveTo(-s * 1.95, -s * 0.46); g.quadraticCurveTo(-s * 0.9, -s * 0.5, -s * 0.72, -s * 0.36);
    g.lineTo(-s * 0.72, s * 0.4); g.quadraticCurveTo(-s * 0.9, s * 0.52, -s * 1.95, s * 0.5); g.fill();
    if (sleeve === 'lace') for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(-s * 0.7 + Math.sin(i) * 3, -s * 0.36 + i * s * 0.095, s * 0.07, 0, 7); g.fill(); } }
  g.beginPath(); g.moveTo(0, -s * 0.24); g.quadraticCurveTo(s * 0.35, -s * 0.34, s * 0.62, -s * 0.26); g.lineTo(s * 0.62, s * 0.24);   // palm
  g.quadraticCurveTo(s * 0.3, s * 0.34, 0, s * 0.26); g.fill();
  for (let f = 0; f < 4; f++) {                                        // fingers, curling toward the thumb
    const y = -s * 0.2 + f * s * 0.14, L = s * [0.42, 0.48, 0.45, 0.36][f], c = curl * (0.9 + f * 0.15);
    let x0 = s * 0.6, y0 = y, a = 0.1 * f - 0.15;
    for (let k = 0; k < 3; k++) { const l = L * [0.45, 0.33, 0.25][k], x1 = x0 + Math.cos(a) * l, y1 = y0 + Math.sin(a) * l;
      capsule(g, [x0, y0], [x1, y1], s * (0.062 - k * 0.008), s * (0.056 - k * 0.008)); x0 = x1; y0 = y1; a += c * 0.9; }
  }
  capsule(g, [s * 0.12, -s * 0.2], [s * 0.42, -s * 0.46 + curl * s * 0.1], s * 0.08, s * 0.06);   // thumb
  capsule(g, [s * 0.42, -s * 0.46 + curl * s * 0.1], [s * 0.64 - curl * s * 0.05, -s * 0.52 + curl * s * 0.2], s * 0.06, s * 0.05);
  g.restore();
}
export function passPen(ctx, beat, t, spb) {
  const u = beat - 26;
  ctx.fillStyle = '#050303'; ctx.fillRect(0, 0, W, H);
  const f = 0.9 + 0.06 * Math.sin(t * 13.1) + 0.04 * Math.sin(t * 29.7), fx = 560, fy = 1330;
  const gl = ctx.createRadialGradient(fx, fy, 10, fx, fy, 1100 * f); gl.addColorStop(0, 'rgba(255,214,150,1)'); gl.addColorStop(0.08, 'rgba(255,170,80,0.7)');
  gl.addColorStop(0.35, 'rgba(160,70,20,0.25)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff6e0'; ctx.beginPath(); ctx.ellipse(fx, fy, 22, 70 * f, 0, 0, 7); ctx.fill();          // the flame
  ctx.fillStyle = '#f0dcb0'; ctx.fillRect(fx - 34, fy + 60, 68, 200);                                          // the candle
  // the hand-over: the 1776 hand brings the quill in from the left, the 2024 hand takes it at 27 and draws it away
  ctx.save(); ctx.translate(540, 980); ctx.scale(1.55, 1.55); ctx.translate(-540, -860);
  const give = ease.inOutCubic(clamp(u / 1.0)), take = ease.inOutCubic(clamp((u - 1.05) / 0.9));
  // the quill moves in with the giver and out with the taker; each hand is placed from its grip on the barrel
  const qx = lerp(250, 470, give) + take * 110, qy = lerp(930, 860, give) - take * 50, qa = -0.5 + take * 0.12;
  const along = d => [qx + Math.cos(qa) * d, qy + Math.sin(qa) * d];
  const gDir = -0.35, gS = 190, gGrip = along(40), gOut = take * 220;
  hand(ctx, gGrip[0] - Math.cos(gDir) * gS * 0.82 - gOut, gGrip[1] - Math.sin(gDir) * gS * 0.82 + gOut * 0.3, gDir, gS, u < 1.05 ? 0.8 : 0.25, 'lace');
  ctx.save(); ctx.translate(qx, qy); ctx.rotate(qa);                                                            // the quill, lit through
  ctx.fillStyle = '#e9d6b0'; ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(560, -6); ctx.lineTo(560, 6); ctx.fill();
  const r = rng(26); ctx.strokeStyle = 'rgba(255,226,170,0.9)'; ctx.lineWidth = 1.4;
  for (let i = 0; i < 150; i++) { const x = 140 + i * 2.8, l = 70 * Math.sin(Math.PI * clamp((x - 140) / 430)) * (0.8 + r() * 0.4);
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + 10, sd * l * 0.5, x + 24 + r() * 8, sd * l); ctx.stroke(); } }
  ctx.fillStyle = '#1a0c06'; ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-70, -3); ctx.lineTo(-70, 3); ctx.fill();
  ctx.restore();
  const tDir = Math.PI + 0.45, tS = 200, tGrip = along(125), tIn = (1 - ease.outCubic(clamp((u - 0.35) / 0.65))) * 420;
  hand(ctx, tGrip[0] - Math.cos(tDir) * tS * 0.8 + tIn, tGrip[1] - Math.sin(tDir) * tS * 0.8 - tIn * 0.2, tDir, tS, u < 1.0 ? 0.3 : 0.85, 'canvas');
  ctx.restore();
  const pg = ctx.createLinearGradient(0, 1500, 0, H); pg.addColorStop(0, '#a88758'); pg.addColorStop(1, '#5e4428');   // the sheet's edge, candle-lit
  ctx.fillStyle = pg; ctx.beginPath(); ctx.moveTo(0, 1480); ctx.lineTo(W, 1440); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  woodtype(ctx, 'PASS THE PEN.', W / 2, 1700, { em: 170, maxW: W - 160, color: '#1a0e08', age: u * spb, seed: 26, rot: -0.035 });
}

// ================================================================ ALL HANDS. : the Klutsis wall (arms only), red duotone, a new wall each hit
function raised(g, x, y, s, a, r) {                                  // a raised open hand and forearm, palm to us, sleeve cuff
  g.save(); g.translate(x, y); g.rotate(a);
  g.beginPath(); g.moveTo(-s * 0.2, s * 3); g.lineTo(-s * 0.17, s * 0.55); g.lineTo(s * 0.17, s * 0.55); g.lineTo(s * 0.21, s * 3); g.fill();
  if (r() < 0.6) { g.fillRect(-s * 0.26, s * 1.25 + r() * s * 0.4, s * 0.52, s * 0.18); }
  g.beginPath(); g.moveTo(-s * 0.2, s * 0.6); g.quadraticCurveTo(-s * 0.3, s * 0.05, -s * 0.24, -s * 0.05); g.lineTo(s * 0.26, -s * 0.05);
  g.quadraticCurveTo(s * 0.28, s * 0.3, s * 0.2, s * 0.6); g.fill();
  const spread = 0.05 + r() * 0.08;
  [[-0.18, 0.62], [-0.06, 0.72], [0.06, 0.7], [0.18, 0.58]].forEach(([fx, L], i) => {
    const an = -Math.PI / 2 + (i - 1.5) * spread;
    capsule(g, [fx * s, -s * 0.02], [fx * s + Math.cos(an) * L * s, -s * 0.02 + Math.sin(an) * L * s], s * 0.075, s * 0.06); });
  capsule(g, [-s * 0.2, s * 0.35], [-s * 0.5, -s * 0.02], s * 0.09, s * 0.068);
  g.restore();
}
const WALLS = {};
function wall(k) {
  if (WALLS[k]) return WALLS[k];
  const c = mk(), g = c.getContext('2d'), r = rng(400 + k * 17);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W / 2, H / 2); g.rotate(-0.56 + (k % 2) * 1.1); g.fillStyle = '#d0141d'; g.fillRect(-1400, -170 - k * 30, 2800, 360 + (k % 3) * 60); g.restore();   // the red band
  g.fillStyle = '#0a0a0a';
  if (k === 5) {                                                       // the one giant hand
    raised(g, 560, 700, 520, -0.08, rng(7));
    for (let i = 0; i < 70; i++) raised(g, r() * W, 1500 + r() * 420, 28 + r() * 30, (r() - 0.5) * 0.5, r);
  } else {
    for (let i = 0; i < 150; i++) { const d = r() ** 1.6, s = lerp(22, 150, d), x = r() * (W + 200) - 100, y = lerp(260, 1650, d) + (r() - 0.5) * 280;
      raised(g, x, y, s, (r() - 0.5) * 0.5 + (k === 1 ? 0.18 : k === 3 ? -0.2 : 0), r); }
  }
  const out = mk();
  pr.render(null, c, [['riso', { inks: ['#c91f37', 'risoBlack'], misreg: 4, contrast: 1.35, grain: 2.2, screen: 0 }]], { t: k, paper: 'ivory', levels: [0, 1, 1] });
  pr.draw(out.getContext('2d')); WALLS[k] = out; return out;
}
export function hands(ctx, beat, spb) {
  const b0 = Math.min(43, Math.floor(beat)), k = beat < 36 ? b0 - 34 : b0 - 38, u = beat - b0;   // 34, 35 -> 0, 1; 40-43 -> 2-5
  const im = wall(k), z = lerp(1.12, 1.02, ease.outExpo(clamp(u * spb / 0.12))) + u * 0.03;
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.drawImage(im, -W / 2, -H / 2); ctx.restore();
  const y = [1500, 420, 1560, 400, 1620, 1690][k];
  if (k === 1 || k === 3) return;                                     // v10: the chant on 34, 40, 42, 43; the wall alone between
  ctx.fillStyle = '#f5ecd8'; ctx.fillRect(40, y - 150, W - 80, 230);
  woodtype(ctx, 'ALL HANDS.', W / 2, y - 30, { em: 200, maxW: W - 160, color: k === 5 ? '#b3121c' : '#0e0d0c', age: u * spb, seed: 34 + k, rot: [-0.02, 0.015, -0.01, 0.02, -0.015, 0][k] });
}

// ================================================================ the press run (36-40): broadsides land on the pile, the town stamp
function townPanel(stampAge) {
  return (g, w, h) => {
    const x = -w * 0.42, y = h * 0.26, pw = w * 0.84, ph = h * 0.17;
    g.strokeStyle = '#18130f'; g.lineWidth = 3; g.strokeRect(x, y, pw, ph);
    g.font = `${Math.round(w * 0.028)}px "IM Fell English SC"`; g.fillStyle = '#18130f'; g.textAlign = 'left'; g.fillText('Chapter', x + 14, y + w * 0.035);
    if (stampAge >= 0) {
      const a = ease.outExpo(clamp(stampAge / 0.06));
      g.save(); g.translate(0, y + ph * 0.58); g.rotate(-0.05); g.scale(lerp(1.3, 1, a), lerp(1.3, 1, a)); g.globalAlpha = a;
      g.globalCompositeOperation = 'multiply'; g.strokeStyle = '#b3121c'; g.lineWidth = 6; g.strokeRect(-pw * 0.47, -ph * 0.42, pw * 0.94, ph * 0.8);
      g.restore();
      woodtype(g, 'SACRAMENTO VALLEY.', 0, y + ph * 0.56, { em: w * 0.16, maxW: pw * 0.92, color: '#b3121c', age: stampAge, seed: 38, rot: -0.05 });
    }
  };
}
export function press(ctx, beat, t, spb) {
  ctx.fillStyle = '#23170f'; ctx.fillRect(0, 0, W, H);
  const r = rng(36); ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (let i = 0; i < 30; i++) ctx.fillRect(0, r() * H, W, 2 + r() * 6);                             // the bench planks
  const sheets = [[36, 0.03], [36.5, -0.04], [37, 0.02], [37.5, -0.02], [38, 0.01]].filter(s => s[0] <= beat);
  sheets.forEach(([b0, rot], i) => {
    const age = beat - b0, d = ease.outCubic(clamp(age * spb / 0.14)), top = i === sheets.length - 1;
    const sx = W / 2 + (i - 2) * 6 + (1 - d) * 90, sy = 980 + (1 - d) * -260;
    ctx.save(); ctx.translate(sx, sy); ctx.scale(lerp(1.18, 1, d), lerp(1.18, 1, d)); ctx.translate(-sx, -sy);
    broadsideSheet(ctx, sx, sy, 900, 1500, rot, ['SIGN', 'ME UP.'], { small: 'American Communist Party', emblem: false, age: top ? (beat - 36) * spb : 9,
      headColor: '#18130f', panel: townPanel(b0 >= 38 ? (beat - 38) * spb : -1) });
    ctx.restore();
  });
  const u = beat - 36;                                                                                  // the ink roller crossing on the first beat
  if (u < 1) { const x = lerp(-200, W + 200, ease.inOutCubic(u)); ctx.fillStyle = '#0c0b0c'; ctx.fillRect(x - 60, 0, 120, H);
    ctx.fillStyle = 'rgba(180,20,30,0.5)'; ctx.fillRect(x - 60, 0, 18, H); ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 10, 0, 10, H); }
}

// ================================================================ the silence (44-46): one drop of red wax, falling on the sheet
export function waxDrop(ctx, beat, S) {                               // S: { paper }
  const u = beat - 44;
  ctx.drawImage(S.paper, 300, 900, 480, 853, 0, 0, W, H);
  ctx.globalCompositeOperation = 'multiply'; const lg = ctx.createLinearGradient(0, 0, W, H); lg.addColorStop(0, '#f6e2bf'); lg.addColorStop(1, '#6a4a2c');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.translate(540, 0); ctx.scale(2.1, 2.1); ctx.translate(-540, 0);                   // a macro: the stick and the bead large
  const tipY = 250, grow = clamp(u / 1.4), fall = clamp((u - 1.4) / 0.6), land = u >= 2 - 0.02;
  ctx.fillStyle = '#6e0a10'; ctx.fillRect(470, -40, 140, tipY + 20);                                   // the stick of sealing wax
  ctx.fillStyle = 'rgba(255,170,150,0.25)'; ctx.fillRect(482, -40, 16, tipY + 10);
  const by = fall > 0 ? tipY + 70 + ease.inCubic(fall) * 560 : tipY + 20 + grow * 60, rr = 22 + grow * 18;
  ctx.fillStyle = '#8e0c14'; ctx.beginPath();
  if (fall <= 0) { ctx.moveTo(515, tipY); ctx.quadraticCurveTo(540 + rr, by, 540, by + rr); ctx.quadraticCurveTo(540 - rr, by, 565, tipY); ctx.fill(); }
  else { ctx.ellipse(540, by, rr * 0.85, rr * (1 + fall * 0.4), 0, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,220,200,0.6)'; ctx.beginPath(); ctx.ellipse(532, by - rr * 0.3, rr * 0.2, rr * 0.3, 0, 0, 7); ctx.fill();
  const sh = ctx.createRadialGradient(560, 880, 0, 560, 880, 80 * (0.4 + fall)); sh.addColorStop(0, `rgba(40,10,5,${0.5 * fall})`); sh.addColorStop(1, 'rgba(40,10,5,0)');
  ctx.fillStyle = sh; ctx.fillRect(440, 780, 240, 200);
  ctx.restore();
  if (land) { ctx.fillStyle = '#8e0c14'; ctx.beginPath(); ctx.ellipse(560, 1830, 170, 110, 0, 0, 7); ctx.fill(); }
}

// ================================================================ v10: the rubber stamp
// A returned-document stamp in red: a double-ruled box and the word, multiplied into whatever is under it. It lands
// on the hit (the first frame already reads) with a 3-frame settle from 118 %.
export function stamp(g, cx, cy, text, { age = 9, em = 190, rot = -0.16, color = '#c0121e' } = {}) {
  gT.setTransform(1, 0, 0, 1, 0, 0); gT.font = `${em}px "${WOODF}"`;
  const tw = Math.min(gT.measureText(text).width, W - 200), bw = tw + em * 0.5, bh = em * 1.25;
  const a = ease.outExpo(clamp(age / 0.1)), sc = lerp(1.18, 1, a);
  g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(sc, sc);
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = lerp(0.7, 0.95, a);
  const r = rng(text.length * 31 + Math.round(em));
  g.strokeStyle = color; g.lineJoin = 'round';
  for (const [inset, lw] of [[0, 14], [26, 5]]) {                      // the double rule, slightly uneven like rubber
    g.lineWidth = lw; g.beginPath();
    const x0 = -bw / 2 + inset, y0 = -bh / 2 + inset, x1 = bw / 2 - inset, y1 = bh / 2 - inset;
    g.moveTo(x0 + r() * 3, y0 + r() * 3); g.lineTo(x1 + r() * 3, y0 + r() * 3); g.lineTo(x1 + r() * 3, y1 + r() * 3); g.lineTo(x0 + r() * 3, y1 + r() * 3); g.closePath(); g.stroke();
  }
  g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1;   // starved rubber: flecks out of the rule
  for (let i = 0; i < 90; i++) { g.beginPath(); g.ellipse((r() - 0.5) * bw, (r() < 0.5 ? -1 : 1) * (bh / 2 - r() * 30), 1 + r() * 5, 1 + r() * 3, r() * 3, 0, 7); g.fill(); }
  g.globalCompositeOperation = 'multiply';
  woodtype(g, text, 0, em * 0.02, { em, maxW: W - 220, color, age: 9, seed: 77 });
  g.restore();
}

// ================================================================ v10: LIFE. LIBERTY. ____ (the 1776 card) and its payoff
// The same card twice. v12 (correctness gate, archive audit 8 Oct): the third item was written. v10/v11 left a ruled blank here
// under "In Congress, July 4, 1776." as if it had not been; the Declaration reads "Life, Liberty and the pursuit of Happiness"
// (NARA transcript of the engrossed copy). On the 1776 sheet (12-17.6) the third line is set as written, in period italic, from 14,
// and the UNFINISHED. stamp comes down on it at 16. On the press (36-40) the 2024 broadside is set the same way, a little lower; the
// line is struck through on 37 (with LIBERTY.) and PRODUCTION. is printed in red on the platen at 38 just above it, where a correction
// goes, so the struck words stay readable under the rule to the end of the shot (40).
const TRIAD = [['LIFE.', 0], ['LIBERTY.', 1], ['PRODUCTION.', 2]];
const HAPPY = 'the pursuit of Happiness';                                // the Declaration's words, verbatim
function happyLine(g, x, yy, w, beat, strikeAt, spb) {
  g.save();
  g.font = 'italic 100px "IM Fell English"';
  const sz = Math.min(118, 100 * w * 0.8 / g.measureText(HAPPY).width);
  g.font = `italic ${sz}px "IM Fell English"`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#18130f'; g.globalAlpha *= 0.92; g.fillText(HAPPY, x, yy);
  if (strikeAt != null && beat >= strikeAt) {                           // struck through: one ruled line drawn across it
    const tw = g.measureText(HAPPY).width, u = ease.outCubic((beat - strikeAt) * spb / 0.18);
    g.globalAlpha = 1; g.fillRect(x - tw / 2 - 14, yy - sz * 0.06, (tw + 28) * u, Math.max(6, sz * 0.09));
  }
  g.restore();
}
function triadRows(g, x, y, w, h, beat, b0, spb, fill, rowGap) {
  const ys = [y - rowGap, y, y + rowGap * (fill ? 0.6 : 1)];             // 2024: PRODUCTION. sits above the struck line, not on it
  TRIAD.forEach(([word, i]) => {
    const on = b0 + i, yy = ys[i];
    if (i === 2 && !fill) {                                              // 1776: the third line as written
      if (beat >= b0 + 2) happyLine(g, x, yy, w, beat, null, spb);
      return;
    }
    if (i === 2) happyLine(g, x, y + rowGap * 1.12, w, beat, b0 + 1, spb);  // 2024: set the same way, struck on 37, PRODUCTION. above it
    if (beat < on) return;
    woodtype(g, word, x, yy, { em: i === 2 ? 190 : 200, maxW: w * 0.86, color: i === 2 ? '#b3121c' : '#18130f', age: (beat - on) * spb, seed: 360 + i, rot: [-0.01, 0.012, fill ? -0.035 : -0.018][i] });
  });
}
export function triadCard(ctx, beat, t, spb, { onDesk = false } = {}) {
  if (onDesk) {                                                        // a cream card laid on the 1776 sheet
    const w = 940, h = 1000, cx = W / 2, cy = 1150, d = ease.outExpo(clamp((beat - 12) * spb / 0.12));
    ctx.save(); ctx.translate(cx, cy + (1 - d) * 40); ctx.rotate(0.012); ctx.globalAlpha = d;
    ctx.shadowColor = 'rgba(20,8,2,0.55)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 16;
    const pg = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); pg.addColorStop(0, '#eedcb6'); pg.addColorStop(1, '#d2b98c');
    ctx.fillStyle = pg; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.shadowColor = 'transparent';
    { const rr = rng(1150); ctx.fillStyle = 'rgba(120,80,40,0.09)'; for (let i = 0; i < 300; i++) ctx.fillRect(-w / 2 + rr() * w, -h / 2 + rr() * h, 1 + rr() * 3, 1 + rr() * 3);
      const vg = ctx.createRadialGradient(0, 0, w * 0.3, 0, 0, w * 0.8); vg.addColorStop(0, 'rgba(90,60,30,0)'); vg.addColorStop(1, 'rgba(90,60,30,0.22)'); ctx.fillStyle = vg; ctx.fillRect(-w / 2, -h / 2, w, h); }
    ctx.fillStyle = '#18130f'; ctx.fillRect(-w * 0.44, -h / 2 + 110, w * 0.88, 6); ctx.fillRect(-w * 0.44, -h / 2 + 124, w * 0.88, 2);
    ctx.font = '46px "IM Fell English SC"'; ctx.textAlign = 'center'; ctx.fillText('In Congress, July 4, 1776.', 0, -h / 2 + 88);
    triadRows(ctx, 0, 60, w, h, beat, 12, spb, false, 260);
    ctx.restore();
    return;
  }
  // the press (36-40): the 2024 broadside on the bench, the roller across it on 36, the platen on each line
  ctx.fillStyle = '#23170f'; ctx.fillRect(0, 0, W, H);
  const r = rng(36); ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (let i = 0; i < 30; i++) ctx.fillRect(0, r() * H, W, 2 + r() * 6);
  const hit = Math.max(...[36, 37, 38].map(b => beat >= b ? Math.exp(-(beat - b) * spb * 18) : 0));
  const w = 980, h = 1560, cx = W / 2 + Math.sin(t * 70) * 6 * hit, cy = 960 + hit * 8;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.01); ctx.scale(1 + hit * 0.012, 1 + hit * 0.012);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-w / 2 + 14, -h / 2 + 18, w, h);
  const pg = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); pg.addColorStop(0, '#f1e3c4'); pg.addColorStop(1, '#d8c29a');
  ctx.fillStyle = pg; ctx.fillRect(-w / 2, -h / 2, w, h);
  const rr = rng(1560); ctx.fillStyle = 'rgba(120,80,40,0.08)';
  for (let i = 0; i < 260; i++) ctx.fillRect(-w / 2 + rr() * w, -h / 2 + rr() * h, 1 + rr() * 3, 1 + rr() * 3);
  ctx.fillStyle = '#18130f'; ctx.fillRect(-w * 0.44, -h / 2 + 150, w * 0.88, 6); ctx.fillRect(-w * 0.44, -h / 2 + 164, w * 0.88, 2);
  ctx.font = '50px "IM Fell English SC"'; ctx.textAlign = 'center'; ctx.fillText('In Chicago, July 21, 2024.', 0, -h / 2 + 118);
  ctx.font = '34px "IM Fell English SC"'; ctx.fillText('American Communist Party', 0, -h / 2 + 218);
  triadRows(ctx, 0, -40, w, h, beat, 36, spb, true, 300);
  ctx.fillStyle = '#18130f'; ctx.fillRect(-w * 0.44, h / 2 - 260, w * 0.88, 3);
  acpEmblem(ctx, 0, h / 2 - 150, 90, { color: '#18130f' });
  ctx.restore();
  const u = beat - 36;                                                 // the ink roller crossing on the first beat
  if (u < 0.8) { const x = lerp(-200, W + 200, ease.inOutCubic(u / 0.8)); ctx.fillStyle = '#0c0b0c'; ctx.fillRect(x - 60, 0, 120, H);
    ctx.fillStyle = 'rgba(180,20,30,0.5)'; ctx.fillRect(x - 60, 0, 18, H); ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 10, 0, 10, H); }
}
