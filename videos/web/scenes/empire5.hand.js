// CIVILIZATION v12: the working hand, redrawn in the piece's own print. v11 printed MELTDOWN v8's point cloud as a glossy glove
// (four red tone levels, a bright highlight band, a halftoned palm). Here the same geometry and the same choreography (open, curl,
// squeeze light out between the knuckles, the fist holds) are drawn as a flat red body, a black keyline outside the form, black
// stipple in the shadows only, a ruled-black sleeve, bare-stock nails and solid gold held in the palm.
import { makeHand, posed } from './empire4.hand.js';
import { P, g, W, H, TAU, RED, BLK, GOLD, PAPER, k, r, d, clamp, lerp, ease, rng, knock, fillP, lineP, poly } from './empire5.kit.js';

const HAND = makeHand(1936, 70000);
const ZC = 5, ZW = Math.ceil(W / ZC), ZH = Math.ceil(H / ZC), ZB = new Float32Array(ZW * ZH);
const HS = new Float32Array(HAND.n * 4);   // screen x, y, depth, lambert
// smooth mask: fill the path on a scratch canvas, blur, then a hard threshold on alpha (clean edges from a scatter of discs)
const mkc = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; };
const [HMa, hma] = mkc(W, H), [HMb, hmb] = mkc(W, H);
function smoothMask(path, box, blur = 3) {
  const [bx0, by0, bx1, by1] = box.map(Math.round), w = Math.max(2, bx1 - bx0), h = Math.max(2, by1 - by0);
  for (const [c, gg] of [[HMa, hma], [HMb, hmb]]) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } gg.setTransform(1, 0, 0, 1, 0, 0); gg.filter = 'none'; gg.clearRect(0, 0, w, h); }
  hma.setTransform(1, 0, 0, 1, -bx0, -by0); hma.fillStyle = '#000'; hma.fill(path); hma.setTransform(1, 0, 0, 1, 0, 0);
  hmb.filter = `blur(${blur}px)`; hmb.drawImage(HMa, 0, 0); hmb.filter = 'none';
  const id = hmb.getImageData(0, 0, w, h), a = id.data;
  for (let i = 3; i < a.length; i += 4) { const v = (a[i] - 96) / 64; a[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); a[i - 3] = a[i - 2] = a[i - 1] = 0; }
  hmb.putImageData(id, 0, 0);
  const out = document.createElement('canvas'); out.width = w; out.height = h; out.getContext('2d').drawImage(HMb, 0, 0);
  return { c: out, x: bx0, y: by0 };
}
const _tc = mkc(8, 8);
function layMask(m, ink, mode) {
  const c = P.plate(ink);
  if (mode === 'knock') { for (const kk of P.inks) { const q = P.g[kk.i]; q.save(); q.globalCompositeOperation = 'destination-out'; q.drawImage(m.c, m.x, m.y); q.restore(); } return; }
  const [tc, tg] = _tc; if (tc.width !== m.c.width || tc.height !== m.c.height) { tc.width = m.c.width; tc.height = m.c.height; }
  tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, tc.width, tc.height); tg.drawImage(m.c, 0, 0);
  tg.globalCompositeOperation = 'source-in'; tg.fillStyle = P.cov(1, ink); tg.fillRect(0, 0, tc.width, tc.height);
  if (mode === 'edge') { // a black ring just outside the gold: the mask grown by drawing it offset in 12 directions, minus itself
    const gq = P.plate('black'); gq.save(); const R = 4;
    tg.globalCompositeOperation = 'source-over';
    const [t2, t2g] = mkcache(tc.width, tc.height); t2g.clearRect(0, 0, tc.width, tc.height);
    for (let a = 0; a < 12; a++) t2g.drawImage(tc, Math.cos(a * Math.PI / 6) * R, Math.sin(a * Math.PI / 6) * R);
    t2g.globalCompositeOperation = 'destination-out'; t2g.drawImage(m.c, 0, 0); t2g.globalCompositeOperation = 'source-in'; t2g.fillStyle = P.cov(1, 'black'); t2g.fillRect(0, 0, t2.width, t2.height); t2g.globalCompositeOperation = 'source-over';
    gq.drawImage(t2, m.x, m.y); gq.restore(); return;
  }
  c.save(); c.globalCompositeOperation = 'source-over'; c.drawImage(tc, m.x, m.y); c.restore();
}
let _t2 = null; const mkcache = (w, h) => { if (!_t2) _t2 = mkc(w, h); if (_t2[0].width !== w || _t2[0].height !== h) { _t2[0].width = w; _t2[0].height = h; } return _t2; };
const smoothPath = m => { const p = new Path2D(); p.rect(m.x, m.y, m.c.width, m.c.height); return p; };   // a clip box (the hatch is bounded by the body's own mask via the knock below)
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// draw the hand: u = how far it has risen (0 below the frame, 1 in place), close = 0 open .. 1 fist, pool = the gold in the palm (0..1)
// returns the palm's screen position (where the gold threads end) and the scale
export function drawHand({ rise, close, pool, S = 470, cx0 = 540, cy0 = 1480, t = 0, frz = false, spillT = 0 }) {
  const pose = 2 * close;
  const cx = cx0 + 20 * Math.sin(t * 0.7 * (frz ? 0 : 1)), cy = cy0 + 1250 * (1 - rise) + (frz ? 0 : 5 * Math.sin(t * 5));
  const tilt = lerp(0.3, 0.12, close), roll = lerp(-0.1, 0.02, close), yaw = lerp(0.12, -0.05, close);
  const cT = Math.cos(tilt), sT = Math.sin(tilt), cR = Math.cos(roll), sR = Math.sin(roll), cY = Math.cos(yaw), sY = Math.sin(yaw);
  const rot = (v, o) => { let x = v[0] * cY + v[2] * sY, y = v[1], zz = -v[0] * sY + v[2] * cY; const y2 = y * cT - zz * sT, z2 = y * sT + zz * cT; y = y2; zz = z2;
    o[0] = x * cR - y * sR; o[1] = x * sR + y * cR; o[2] = zz; return o; };
  const D = 7, OY = 0.55;
  const proj = (v, o) => { const f = D / (D - v[2]); o[0] = cx + v[0] * S * f; o[1] = cy - (v[1] - OY) * S * f; o[2] = v[2]; return o; };
  const L = nrm([-0.35, 0.75, 0.55]);
  const palm = proj(rot([0, 0.5, 0.3], [0, 0, 0]), [0, 0, 0]);
  if (rise <= 0.001) return { palm, S, any: false };
  ZB.fill(-1e9); const v = [0, 0, 0], w = [0, 0, 0], q = [0, 0, 0], nn = [0, 0, 0];
  for (let i = 0; i < HAND.n; i++) {
    posed(HAND, i, pose, v); rot(v, w); proj(w, q);
    const j = i * 3; for (let kk = 0; kk < 3; kk++) nn[kk] = HAND.N0[j + kk] + (HAND.N2[j + kk] - HAND.N0[j + kk]) * close; rot(nn, w);
    const lam = Math.max(0, (w[0] * L[0] + w[1] * L[1] + w[2] * L[2]) / (Math.hypot(w[0], w[1], w[2]) || 1)), facing = w[2];
    HS[i * 4] = q[0]; HS[i * 4 + 1] = q[1]; HS[i * 4 + 2] = q[2]; HS[i * 4 + 3] = HAND.kind[i] === 1 ? 1 : (facing < -0.25 ? -1 : lam);
    if (HAND.kind[i] === 1 || q[0] < 0 || q[0] >= W || q[1] < 0 || q[1] >= H) continue;
    const c = Math.floor(q[1] / ZC) * ZW + Math.floor(q[0] / ZC); if (q[2] > ZB[c]) ZB[c] = q[2];
  }
  const vis = i => { const x = HS[i * 4], y = HS[i * 4 + 1]; if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const c = Math.floor(y / ZC) * ZW + Math.floor(x / ZC); return HS[i * 4 + 2] >= ZB[c] - 0.09; };
  // the form: every skin / cuff / nail point as a small disc; a smoothed mask (blur, then a hard threshold) gives clean finger edges
  const rad = S * 0.0145, body = new Path2D(), keyp = new Path2D(), stip = new Path2D(), hatch = new Path2D(), cuff = new Path2D(), nails = new Path2D(), goldP = new Path2D();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < HAND.n; i++) { if (HAND.kind[i] === 1) continue; const x = HS[i * 4], y = HS[i * 4 + 1]; if (y > H + 60 || y < -60 || x < -60 || x > W + 60) continue;
    body.moveTo(x + rad, y); body.arc(x, y, rad, 0, TAU); keyp.moveTo(x + rad + 6, y); keyp.arc(x, y, rad + 6, 0, TAU);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const box = [Math.max(0, x0 - 40), Math.max(0, y0 - 40), Math.min(W, x1 + 40), Math.min(H, y1 + 40)];
  const mKey = smoothMask(keyp, box, 3.2), mBody = smoothMask(body, box, 3.2);
  layMask(mKey, 'black', 'knock'); layMask(mKey, 'black', 'lay');
  layMask(mBody, 'black', 'knock'); layMask(mBody, 'red', 'lay');
  // the sleeve in ruled black, the shadows ruled and stippled, nails bare stock; all clipped to the body
  for (let i = 0; i < HAND.n; i++) {
    const kd = HAND.kind[i], lam = HS[i * 4 + 3], x = HS[i * 4], y = HS[i * 4 + 1];
    if (kd === 1) { if (pool > 0 && vis(i) && HAND.tone[i] < pool) goldP.rect(x - 3.6, y - 3.6, 7.2, 7.2); continue; }
    if (lam < 0 || !vis(i)) continue;
    if (kd === 2) { cuff.rect(x - 3, y - 3, 6, 6); continue; }
    if (kd === 3) continue;
    const shade = 1 - lam;
    if (lam < 0.2) hatch.rect(x - 3.2, y - 3.2, 6.4, 6.4);
    else if (HAND.tone[i] < shade * shade * 0.42 - 0.1) stip.arc(x + 1.9, y, 1.9, 0, TAU), stip.closePath();
  }
  g.save(); g.globalCompositeOperation = 'multiply'; fillP(hatch, k(0.62)); fillP(stip, k(1)); fillP(cuff, k(0.62)); g.restore();
  if (close < 0.5) { g.strokeStyle = k(1); g.lineWidth = 3;
    for (const ln of HAND.crease) { g.beginPath(); ln.forEach((p0, kk) => { rot(p0, w); proj(w, q); kk ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); } }
  // what the palm holds: solid gold in a keyline, on bare stock
  if (pool > 0.02) { const pb = [box[0], box[1], box[2], box[3]], mG = smoothMask(goldP, pb, 4.5), pK = new Path2D();
    layMask(mG, 'black', 'knock'); layMask(mG, 'gold', 'lay'); layMask(mG, 'black', 'edge'); }
  // light spills between the knuckles as the fingers close: tapered rays
  if (spillT > 0) { const R = rng(39);
    for (let kk = 0; kk < 9; kk++) { const a = -Math.PI / 2 + (R() - 0.5) * 2.6, L0 = S * 0.32, L1 = S * (0.3 + R() * 0.35) * spillT, w0 = 34 + R() * 16;
      const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca, p0 = [palm[0] + ca * L0, palm[1] + sa * L0], p1 = [p0[0] + ca * L1, p0[1] + sa * L1];
      const tri = (grow) => poly([[p0[0] + px * (w0 / 2 + grow), p0[1] + py * (w0 / 2 + grow)], [p0[0] - px * (w0 / 2 + grow), p0[1] - py * (w0 / 2 + grow)], [p1[0] + ca * grow, p1[1] + sa * grow]], PAPER);
      tri(5); g.fillStyle = d(1); g.beginPath(); g.moveTo(p0[0] + px * w0 / 2, p0[1] + py * w0 / 2); g.lineTo(p0[0] - px * w0 / 2, p0[1] - py * w0 / 2); g.lineTo(p1[0], p1[1]); g.closePath(); g.fill(); } }
  return { palm, S, any: true };
}
