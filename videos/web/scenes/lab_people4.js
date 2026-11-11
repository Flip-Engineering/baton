// LAB / PEOPLE 4 (HUMAN studio, cycle 4): the people reel. Real workers from film turned into figures (figure_ref.js on
// scripts/roto.py mattes), the surge as counter-moving registers with the hit as an event (surge.js), a face at world
// scale, the fist turntable (fist4.js) and the driver's hands.
//   ?subject=fig&who=tapper|foundry|profile|foundry_face&mode=sil|engrave|print|source
//   ?subject=surge&style=wedge            (t = song time; the event sits on the measured onset &onset=16.8)
//   ?subject=face&mode=engrave|print|source
//   ?subject=fist&a=0..7&mode=sil|lit|disc      ?subject=driver&mode=print|sil
// window.renderFrame(t) draws into #out and returns the shot's measurements (window.labInfo).
import { loadRef, loadRefSeq, silhouette, engrave, print, source, place } from '../lib/fx/figure_ref.js';
import { Surge } from '../lib/fx/surge.js';

const Q = new URLSearchParams(location.search);
const SUBJ = Q.get('subject') || 'fig', MODE = Q.get('mode') || 'sil', WHO = Q.get('who') || 'tapper';
const W = 1080, H = 1920;
const out = document.getElementById('out'), ctx = out.getContext('2d', { willReadFrequently: true });
window.labInfo = {};
const S = {};
let SH = null;

// ---------------------------------------------------------------- the three workers, three renderings
function furnaceGround(g, { hot = [900, 1500] } = {}) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#120806'); gr.addColorStop(0.6, '#3a1208'); gr.addColorStop(1, '#6a2008');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(hot[0], hot[1], 20, hot[0], hot[1], 900); rg.addColorStop(0, '#ffd27a'); rg.addColorStop(0.18, '#ff8a2a'); rg.addColorStop(0.5, 'rgba(200,60,16,0.55)'); rg.addColorStop(1, 'rgba(120,30,8,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
}
function paper(g, c = '#efe6cf') { g.fillStyle = c; g.fillRect(0, 0, W, H); }
S.fig = async () => {
  const F = await loadRef(WHO), m = F.meta, bb = m.bbox, fh = bb[3] - bb[1];
  return t => {
    const info = { who: WHO, mode: MODE, src: m.source, tc: m.tc, measures: m.measures };
    if (MODE === 'source') { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); source(ctx, F, { box: [0, 300, W, 1620] }); return info; }
    if (WHO === 'tapper') {
      // the tapper at the taphole: the pour's light from lower right, the figure cut against it, cropped by the frame's foot
      const h = 1400 * F.h / fh, y = 1840, P = place(F, { x: 600, y, h }), hot = [P.x0 + 905 * P.k, P.y0 + 850 * P.k];   // the bar's end in the taphole
      if (MODE === 'sil') { furnaceGround(ctx, { hot }); ctx.fillStyle = '#0a0504'; ctx.fillRect(0, y - 6, W, H - y + 6); Object.assign(info, silhouette(ctx, F, { x: 600, y, h, light: [1, 0.35], rim: '#ffd08a', rimW: 3.2, ink: '#0a0504', notan: +(Q.get('notan') || 0.7) })); }
      if (MODE === 'engrave') { paper(ctx); Object.assign(info, engrave(ctx, F, { x: 600, y, h, pitch: 5.5 })); }
      if (MODE === 'print') { ctx.fillStyle = '#c8201a'; ctx.fillRect(0, 0, W, H); Object.assign(info, print(ctx, F, { x: 600, y, h, pitch: 10 })); }
    } else if (WHO === 'foundry' || WHO === 'foundry_face') {
      const box = WHO === 'foundry' ? [-150, 300, 1130, 1975] : [-60, 300, 1140, 1975];   // frame-cut edges (the film's own frame) go off canvas   // a bust: fit the crop, cropped by the frame's foot
      const x = undefined, y = undefined, h = undefined;
      if (MODE === 'sil') { furnaceGround(ctx, { hot: [150, 500] }); Object.assign(info, silhouette(ctx, F, { box, light: [-1, -0.2], rim: '#ffd08a', rimW: 3, notan: +(Q.get('notan') || 0.62) })); }
      if (MODE === 'engrave') { paper(ctx); Object.assign(info, engrave(ctx, F, { box, pitch: +(Q.get('pitch') || 5.2), planes: +(Q.get('planes') || 5), gamma: +(Q.get('gamma') || 0.8) })); }
      if (MODE === 'print') { ctx.fillStyle = '#c8201a'; ctx.fillRect(0, 0, W, H); Object.assign(info, print(ctx, F, { box, pitch: 10 })); }
    } else {
      const box = [-776, -22, 1080, 1370], x = undefined, y = undefined, h = undefined;   // the head at monument scale: the film frame's cut through the cap goes off the top
      if (MODE === 'sil') { ctx.fillStyle = '#e8d6b0'; ctx.fillRect(0, 0, W, H); Object.assign(info, silhouette(ctx, F, { box, light: [-1, -0.5], rim: '#fff4dc', rimW: 2, notan: +(Q.get('notan') || 0.6), ink: '#15110e' })); }
      if (MODE === 'engrave') { paper(ctx); Object.assign(info, engrave(ctx, F, { box, pitch: 5.5 })); }
      if (MODE === 'print') { ctx.fillStyle = '#c8201a'; ctx.fillRect(0, 0, W, H); Object.assign(info, print(ctx, F, { box, pitch: +(Q.get('pitch') || 11) })); }
    }
    return info;
  };
};

// ---------------------------------------------------------------- the surge (2 s on RED WEDGE, the hit on the measured onset)
S.surge = async () => {
  const SG = await Surge.create({ W, H }), onset = +(Q.get('onset') || 16.8);
  const crowd = SG.design({ seed: +(Q.get('seed') || 4), style: Q.get('style') || 'wedge', registers: [
    { role: 'near', line: [[-160, 2140], [1260, 1760]], h: 900, dir: 1, speed: 210, n: 9, lean: 0.1, fists: 0.34, clump: 3, gap: 0.15 },
    { role: 'mid', line: [[-120, 1130], [1200, 1400]], h: 360, dir: -1, speed: 150, n: 26, flags: 2, fists: 0.3, tools: 0.25, bridge: true, clump: 5, gap: 0.25 },
    { role: 'far', line: [[-60, 800], [1140, 580]], h: 150, dir: 1, speed: 70, n: 60, flags: 3, fists: 0.4, tools: 0.2, clump: 8, gap: 0.2 },
    { role: 'texture', line: [[-40, 470], [1120, 560]], h: 72, dir: -1, speed: 40, n: 110, flags: 4, fists: 0.45, clump: 12, gap: 0.15 },
  ] });
  crowd.event({ onset, fps: 30, pre: 5, settle: 8, lunge: 0.08, beats: (Q.get('beats') || '15.6,16.0,17.2').split(',').map(Number) });
  return t => SG.frame(ctx, crowd, t).info;
};

// ---------------------------------------------------------------- a face at world scale (the face 250-500 px on screen)
// Change C's rule for faces, in order: (a) a real face from film through the engraved or print treatment; (b) a CG head
// only as planes painted from a matched film face; (c) never a smooth lit CG face over 200 px. This is (a): the man's
// own world (the unmatted crop of the same frame: the furnace, the chain, the hood) engraved as the ground in ONE
// horizontal ruling at half weight, and the man cut in his own planes (figure_ref.engrave) over it, so the face is the
// densest, most varied drawing in the frame and the world is still there.
S.face = async () => {
  const who = Q.get('who') || 'foundry_face', F = await loadRef(who), { toneField, burin } = await import('../lib/fx/art/burin2d.js');
  const plate = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = new URL(`../assets/roto/${who}_plate.jpg`, import.meta.url).href; });
  const box = who === 'foundry_face' ? [-100, -10, 1180, 1935] : [-120, 200, 1200, 1800], P = place(F, { box });
  return t => {
    const info = { who, face_px: Math.round(260 * P.k) };
    if (MODE === 'source') { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); ctx.drawImage(plate, P.x0, P.y0, F.w * P.k, F.h * P.k); return info; }
    const gc = Object.assign(document.createElement('canvas'), { width: W, height: H }), gg = gc.getContext('2d');
    gg.fillStyle = '#fff'; gg.fillRect(0, 0, W, H); gg.drawImage(plate, P.x0, P.y0, F.w * P.k, F.h * P.k);
    if (MODE === 'engrave') {
      const T = toneField(gc, { gamma: 0.9, gain: 0.55, lift: 0.02 }); burin(ctx, T, { pitch: 5.5, base: 0, cross: 0.9, crossFrom: 0.5, dotFrom: 2, warp: 0.6, ink: '#15110F', paper: '#EFE6CF' });
      Object.assign(info, engrave(ctx, F, { box, pitch: +(Q.get('pitch') || 4.6), planes: 5, gamma: 0.8, clarity: 0.9 }));
    } else if (MODE === 'print') {
      ctx.fillStyle = '#c8201a'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(gc, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      Object.assign(info, print(ctx, F, { box, pitch: 9 }));
    }
    return info;
  };
};

// ---------------------------------------------------------------- the driver's hands (OWN THE FUTURE), traced from film
// The grip is REAL: Master Hands IV's 1936 wheel coda (NFPF 31:07-31:09), both hands taking the wheel, cut frame by
// frame by roto.py seq. Only the grip and the anatomy come from the film: the wheel is redrawn as a 2036 truck wheel
// (a thick wrapped rim, three flat spokes at 9, 3 and 6, the airbag pad) in the film wheel's own ellipse, the old wheel
// is subtracted from the hands (the first frame, before the hands arrive, is the wheel alone), the consumer's ring hand
// is a leather work glove (ink with a sheen, no skin planes) and the right hand is bare, sun-darkened, cut in two values.
// Light: the gantry legend sweeping across the knuckles and landing ON the hit; sodium as the rim. The grip plays at
// the film's own speed so the hands close ON the measured onset, then squeeze for 3 frames.
//   &hit=22.942 (OTF v7 HAMMER DOWN., measured)   mode=print (NOTAN) | sil
S.driver = async () => {
  const seq = await loadRefSeq('wheel'), m = seq.meta, fr = seq.frames, n = fr.length, E = m.ellipse, hit = +(Q.get('hit') || 22.942);
  const F0 = fr[0], kW = +(Q.get('k') || 1.3), P = { k: kW, x0: 560 - E.cx * kW, y0: 1260 - E.cy * kW };   // the wheel's hub at (560, 1260), the rim cut by the frame
  const X = x => P.x0 + x * P.k, Y = y => P.y0 + y * P.k;
  // per frame: the hands layer at canvas scale (alpha minus the old wheel, luma), cached
  const raster = F => { const c = document.createElement('canvas'); c.width = Math.ceil(F.w * P.k); c.height = Math.ceil(F.h * P.k); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(F.img, 0, 0, c.width, c.height); return { w: c.width, h: c.height, D: g.getImageData(0, 0, c.width, c.height).data }; };
  const R0 = raster(F0), w = R0.w, h = R0.h, W0 = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) W0[i] = R0.D[i * 4 + 3] / 255;
  { const r = Math.round(6 * P.k), tmp = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let mx = 0; for (let d = -r; d <= r; d += 2) { const xx = x + d; if (xx >= 0 && xx < w) mx = Math.max(mx, W0[y * w + xx]); } tmp[y * w + x] = mx; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let mx = 0; for (let d = -r; d <= r; d += 2) { const yy = y + d; if (yy >= 0 && yy < h) mx = Math.max(mx, tmp[yy * w + x]); } W0[y * w + x] = mx; } }
  const hubX = X(E.cx) - P.x0, cache = new Map();
  // min / max filters (separable, square) for the opening that drops the old wheel's thin chrome spokes from the hands
  const filt = (a, r, op) => { const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = op === 'min' ? 1 : 0; for (let d = -r; d <= r; d++) { const q = a[y * w + Math.min(w - 1, Math.max(0, x + d))]; v = op === 'min' ? Math.min(v, q) : Math.max(v, q); } t[y * w + x] = v; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = op === 'min' ? 1 : 0; for (let d = -r; d <= r; d++) { const q = t[Math.min(h - 1, Math.max(0, y + d)) * w + x]; v = op === 'min' ? Math.min(v, q) : Math.max(v, q); } o[y * w + x] = v; }
    return o; };
  let norm = null;
  const hands = k => { if (cache.has(k)) return cache.get(k); const R = raster(fr[k]), A = new Float32Array(w * h), L = new Float32Array(w * h), G = new Uint8Array(w * h), S = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const a = R.D[i * 4 + 3] / 255; if (a < 0.02) continue; L[i] = (0.2126 * R.D[i * 4] + 0.7152 * R.D[i * 4 + 1] + 0.0722 * R.D[i * 4 + 2]) / 255 / Math.max(a, 0.05); }
    if (!norm) { const Rl = raster(fr[n - 1]), v = []; for (let i = 0; i < w * h; i += 3) { const a = Rl.D[i * 4 + 3] / 255; if (a > 0.6 && W0[i] < 0.5) v.push((0.2126 * Rl.D[i * 4] + 0.7152 * Rl.D[i * 4 + 1] + 0.0722 * Rl.D[i * 4 + 2]) / 255 / a); } v.sort((a, b) => a - b); norm = [v[Math.floor(v.length * 0.05)], v[Math.floor(v.length * 0.97)]]; }
    for (let i = 0; i < w * h; i++) { L[i] = clamp01((L[i] - norm[0]) / Math.max(0.05, norm[1] - norm[0])); S[i] = R.D[i * 4 + 3] > 5 ? clamp01((L[i] - 0.38) / 0.12) : 0; }
    const r = Math.max(2, Math.round(5 * P.k)), So = filt(filt(S, r, 'min'), r, 'max');      // skin blobs survive, spokes and chrome glints do not
    const ca = Math.cos(-E.deg * Math.PI / 180), sa = Math.sin(-E.deg * Math.PI / 180), hx = E.cx * P.k, hy = E.cy * P.k;
    for (let i = 0; i < w * h; i++) { const a = R.D[i * 4 + 3] / 255; if (a < 0.02) continue; const x = i % w - hx, y = ((i / w) | 0) - hy, u = (x * ca - y * sa) / (E.a * P.k), v = (x * sa + y * ca) / (E.b * P.k);
      const hub = Math.hypot(u, v) < 0.8 ? 1 : 0;                  // inside the rim the 1936 hub and chrome spokes never pass as a hand
      A[i] = a * Math.max(1 - W0[i], So[i] * (1 - hub)); G[i] = (i % w) < hubX - 30 * P.k ? 1 : 0; }
    const o = { A, L, G }; cache.set(k, o); return o; };
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const layer = document.createElement('canvas'); layer.width = w; layer.height = h; const lg = layer.getContext('2d');
  function wheel(g, t, sweepX) {   // the 2036 truck wheel in the film wheel's ellipse
    g.save(); g.translate(X(E.cx), Y(E.cy)); g.rotate(E.deg * Math.PI / 180); g.scale(E.a * P.k, E.b * P.k);
    const u = 1 / (E.a * P.k);
    g.fillStyle = '#16171b'; g.beginPath(); g.ellipse(0, 0, 0.36, 0.36, 0, 0, Math.PI * 2); g.fill();                       // airbag pad
    g.strokeStyle = '#2a2c31'; g.lineWidth = 0.015; g.beginPath(); g.ellipse(0, 0, 0.27, 0.27, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#2e3136'; for (const a of [Math.PI, 0, Math.PI / 2]) { g.save(); g.rotate(a); g.fillRect(0.3, -0.085, 0.62, 0.17); g.restore(); }   // three flat spokes
    g.strokeStyle = '#0c0c0f'; g.lineWidth = 0.15; g.beginPath(); g.ellipse(0, 0, 0.93, 0.93, 0, 0, Math.PI * 2); g.stroke();   // the thick wrapped rim
    { const th = Math.atan2(-1 / E.b, 0) - E.deg * Math.PI / 180, up = Math.atan2(Math.sin(th) * E.a, Math.cos(th) * E.b); g.strokeStyle = 'rgba(255,150,60,0.9)'; g.lineWidth = 0.022; g.beginPath(); g.ellipse(0, 0, 0.99, 0.99, 0, up - 1.1, up + 1.1); g.stroke(); }   // sodium rim on the edge facing up
    g.strokeStyle = 'rgba(40,40,46,1)'; g.lineWidth = 0.006; for (let k = 0; k < 90; k++) { const a = k / 90 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * 0.87, Math.sin(a) * 0.87); g.lineTo(Math.cos(a + 0.03) * 0.99, Math.sin(a + 0.03) * 0.99); g.stroke(); }   // the wrap's stitches
    g.restore();
  }
  function world(g, t, sweepX) {   // the cab at night: the windshield, the gantry and its legend, the wet road
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#04161a'); gr.addColorStop(0.45, '#0b2a2e'); gr.addColorStop(0.62, '#061012'); gr.addColorStop(1, '#030607');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0f5a34'; g.fillRect(130, 250, 820, 260); g.fillStyle = 'rgba(210,255,220,0.9)'; for (let k = 0; k < 3; k++) g.fillRect(190, 300 + k * 64, 420 + k * 90, 26);   // the sign and its legend bars (no words: the words are the piece's)
    g.strokeStyle = '#1b2a2c'; g.lineWidth = 16; g.beginPath(); g.moveTo(0, 240); g.lineTo(W, 228); g.stroke();
    g.fillStyle = '#081416'; g.fillRect(0, 700, W, 40);
    g.strokeStyle = 'rgba(255,170,70,0.35)'; g.lineWidth = 4; for (const x of [300, 780]) { g.beginPath(); g.moveTo(540, 760); g.lineTo(x < 540 ? -200 : 1280, 1400); g.stroke(); }
    g.fillStyle = '#050708'; g.fillRect(0, 920, W, H - 920);                          // the dash
  }
  return t => {
    const kf = Math.max(0, Math.min(n - 1, Math.floor((t - (hit - (n - 1) / m.fps)) * m.fps))), kh = Math.round((t - hit) * 30);
    const sweepX = W * (-0.2 + 1.1 * clamp01((t - (hit - 0.75)) / 0.75));             // the legend light crossing, landing on the hit
    const flash = kh >= 0 && kh < 8 ? [1, 0.75, 0.5, 0.32, 0.2, 0.12, 0.06, 0.03][kh] : 0;   // the legend lands: the cab floods with its light
    ctx.save(); const push = 1 + 0.035 * flash; ctx.translate(560, 1260); ctx.scale(push, push); ctx.translate(-560, -1260);
    world(ctx, t, sweepX); wheel(ctx, t, sweepX);
    const Hn = hands(kf), im = lg.createImageData(w, h), D = im.data;
    const squeeze = kh >= 0 && kh < 4 ? [1, 0.8, 0.5, 0.2][kh] : 0;
    for (let i = 0; i < w * h; i++) { const a = Hn.A[i]; if (a < 0.02) continue; const x = (i % w) + P.x0, y = ((i / w) | 0) + P.y0;
      const band = Math.exp(-Math.pow((x - sweepX + (y - 1300) * 0.35) / 150, 2)) * (MODE === 'sil' ? 0.5 : 1), l = Hn.L[i];
      let col;
      if (Hn.G[i]) { const sheen = clamp01((l - 0.5 + band * 0.4) / 0.1); col = [14 + 60 * sheen, 11 + 40 * sheen, 10 + 24 * sheen]; }   // the leather glove
      else { const th = Math.max(0.4, 0.6 - 0.32 * band - 0.3 * flash) + 0.08 * squeeze, lit = MODE === 'sil' ? band * clamp01((l - th) / 0.06) : clamp01((l - th) / 0.06); col = [12 + (206 + 30 * band) * lit, 8 + (140 + 60 * band) * lit, 6 + (96 + 50 * band) * lit];
        col = col.map(v => v * (1 - 0.25 * squeeze)); }
      { const o = Math.round(3 * P.k), j = i - o * w + o, up = (i % w) + o < w && j >= 0 ? Hn.A[j] : 0, rim = clamp01((a - up) * 1.6) * 0.85;   // sodium from upper right: sleeves and cuffs keep an edge
        col = col.map((v, c) => v + ([255, 150, 60][c] - v) * rim); }
      D[i * 4] = col[0]; D[i * 4 + 1] = col[1]; D[i * 4 + 2] = col[2]; D[i * 4 + 3] = Math.round(Math.min(1, a * 1.2) * 255); }
    lg.putImageData(im, 0, 0);
    const sq = 1 - 0.012 * squeeze; ctx.save(); ctx.translate(X(E.cx), Y(E.cy)); ctx.scale(sq, sq); ctx.translate(-X(E.cx), -Y(E.cy)); ctx.drawImage(layer, P.x0, P.y0); ctx.restore();
    if (flash) { ctx.globalCompositeOperation = 'screen'; const gl = ctx.createLinearGradient(0, 0, 0, H); gl.addColorStop(0, `rgba(190,255,210,${0.75 * flash})`); gl.addColorStop(0.5, `rgba(120,220,160,${0.4 * flash})`); gl.addColorStop(1, `rgba(40,90,60,${0.12 * flash})`);
      ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    ctx.restore();
    return { frame: kf, kh, sweepX: Math.round(sweepX), licence: m.licence, tc: m.tc };
  };
};

// ---------------------------------------------------------------- the fist: hero.fist({ form: 'bridgman' }) on a bent raised arm
// The arm is gesture.js ROTFRONT (elbow out at shoulder height, forearm vertical: the RFB fist, measured by measureArm),
// the forearm Graham's (hero.forearm), the fist Bridgman's (knuckle arch, thumb clamped over the middle phalanges, the
// square front). A turntable: the camera orbits the fist at a * 45 degrees, a little below it (the monument angle).
//   &form=bridgman|default  &a=0..7  mode=sil (black on paper) | disc (against the GIANT sun) | lit (raking key)
async function fistRig(form) {
  const THREE = await import('three'), { Stage } = await import('../lib/fx/folk_worlds.js');
  const st = new Stage({ W, H }); await st.init();
  const h = st.hero({ variant: 'heavy', height: 1.84, kind: 'work', shirt: '#2a2622', sleeve: -0.05, skin: '#9a6a48', dirt: 0.5, stubble: 0.8, beard: 0, hat: 'none', seed: 11, age: 0.55 });
  h.resetPose(); h.update(); h.group.position.set(0, 0, 0); h.update();
  h.gesture('L', 'SIDE', { fist: false }); h.relaxHand('L');
  const g = h.gesture('R', 'ROTFRONT', { fistForm: form === 'default' ? null : 'bridgman', fistScale: 1 });
  if (form !== 'default') h.forearm('R', +(Q.get('graham') || 1.4));
  h.update();
  const fistC = h.palm('R').palm.clone(), elbow = h.joint('lowerarm01.R'), shoulder = h.joint('upperarm01.R');
  return { THREE, st, h, fistC, elbow, shoulder };
}
S.fist = async () => {
  const form = Q.get('form') || 'bridgman', R = await fistRig(form), { THREE, st, h, fistC, elbow } = R;
  const aim = Q.get('close') ? fistC.clone() : fistC.clone().lerp(elbow, 0.42);                  // frame the fist in the upper third, the forearm running down
  const key = new THREE.DirectionalLight('#ffe2c0', 3.2), fill = new THREE.HemisphereLight('#5a4a44', '#140a08', 0.35), back = new THREE.DirectionalLight('#ff9a5a', 2.4);
  st.scene.add(key, key.target, fill, back, back.target);
  return t => {
    const a = +(Q.get('a') || 0) * Math.PI / 4, dist = +(Q.get('dist') || 1.25), el = +(Q.get('el') || -0.28);
    const off = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)).multiplyScalar(dist);
    st.lookAt(aim.clone().add(off), aim.clone().add(new THREE.Vector3(0, 0.07, 0)), +(Q.get('fov') || 30));
    const side = new THREE.Vector3().crossVectors(off, new THREE.Vector3(0, 1, 0)).normalize();
    key.position.copy(fistC).addScaledVector(side, 2).add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(off.clone().normalize(), 0.8); key.target.position.copy(fistC);   // raking, from above and the side
    back.position.copy(fistC).addScaledVector(off.clone().normalize(), -3).addScaledVector(side, -1).add(new THREE.Vector3(0, 0.8, 0)); back.target.position.copy(fistC);
    const info = { form, a: Q.get('a') || 0, fistSolve: h._fistInfo?.R?.thumb, gestures: h.gestures(st.camera, W, H).map(q => ({ side: q.side, name: q.name, interior: q.interior, elev: q.elev, faDev: q.faDev, fistPx: q.fistPx, flags: q.flags })) };
    if (MODE === 'lit') {
      const gr = ctx.createRadialGradient(W * 0.35, H * 0.3, 40, W * 0.5, H * 0.5, H * 0.8); gr.addColorStop(0, '#3a1a10'); gr.addColorStop(1, '#070304'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(st.renderLit(), 0, 0);
    } else {
      const sun = st.project(fistC.clone().add(off.clone().normalize().multiplyScalar(-40)));
      if (MODE === 'disc') { ctx.fillStyle = '#b8140e'; ctx.fillRect(0, 0, W, H); const fp = st.project(fistC); ctx.fillStyle = '#ff5a1e'; ctx.beginPath(); ctx.arc(fp[0] - 40, fp[1] + 120, 520, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillStyle = '#efe6cf'; ctx.fillRect(0, 0, W, H); }
      st.renderRim(new THREE.Vector3(sun[0], sun[1], 0).set(0, 0, 0).copy(fistC).add(off.clone().normalize().multiplyScalar(-400)).add(new THREE.Vector3(0, 120, 0)), { rim: MODE === 'disc' ? '#ffb070' : '#0b0706', rim2: '#0b0706', body: '#0b0706', rimW: MODE === 'disc' ? 0.25 : 0 });
      ctx.drawImage(st.canvas, 0, 0);
    }
    const fp = st.project(fistC); info.fist_px = fp.slice(0, 2).map(Math.round); info.fist_scale_px = Math.round(0.1 * st.pxPerM(fistC));
    return info;
  };
};

// the baked turntable (ART c2's cost rule: no raymarch or hero solve in a piece's frame): node web/sil_bake.mjs lab_people4
//   -> web/assets/sil/fist_cards.png (8 angles x [silhouette, lit], 360 x 640 cells, straight alpha) + fist_cards.json
//   (per cell: angle, light, the fist's centre and size in cell px, the measured arm). A piece draws a card like a SIL cell.
window.fistBake = async () => {
  const THREE = await import('three'), R = await fistRig('bridgman'), { st, h, fistC, elbow } = R, CW = 360, CH = 640;
  const atlas = Object.assign(document.createElement('canvas'), { width: CW * 8, height: CH * 2 }), ag = atlas.getContext('2d');
  const aim = fistC.clone().lerp(elbow, 0.42), key = new THREE.DirectionalLight('#ffe2c0', 3.2), fill = new THREE.HemisphereLight('#5a4a44', '#140a08', 0.35), back = new THREE.DirectionalLight('#ff9a5a', 2.4);
  st.scene.add(key, key.target, fill, back, back.target); const cells = [];
  for (let a = 0; a < 8; a++) {
    const an = a * Math.PI / 4, off = new THREE.Vector3(Math.sin(an) * Math.cos(-0.28), Math.sin(-0.28), Math.cos(an) * Math.cos(-0.28)).multiplyScalar(1.25);
    st.lookAt(aim.clone().add(off), aim.clone().add(new THREE.Vector3(0, 0.07, 0)), 30);
    const side = new THREE.Vector3().crossVectors(off, new THREE.Vector3(0, 1, 0)).normalize();
    key.position.copy(fistC).addScaledVector(side, 2).add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(off.clone().normalize(), 0.8); key.target.position.copy(fistC);
    back.position.copy(fistC).addScaledVector(off.clone().normalize(), -3).addScaledVector(side, -1).add(new THREE.Vector3(0, 0.8, 0)); back.target.position.copy(fistC);
    const fp = st.project(fistC), gs = h.gestures(st.camera, W, H).map(q => ({ name: q.name, interior: q.interior, flags: q.flags }));
    for (const [row, light] of [[0, 'sil'], [1, 'lit']]) {
      if (light === 'sil') st.renderRim(fistC.clone().addScaledVector(off.clone().normalize(), -400), { rim: '#0b0706', rim2: '#0b0706', body: '#0b0706', rimW: 0 }); else st.renderLit();
      ag.drawImage(st.canvas, a * CW, row * CH, CW, CH);
      cells.push({ a, deg: a * 45, light, x: a * CW, y: row * CH, fist: [+(fp[0] / 3).toFixed(1), +(fp[1] / 3).toFixed(1)], fistPx: +(0.1 * st.pxPerM(fistC) / 3).toFixed(1), arm: gs });
    }
  }
  window.silAtlas = atlas;
  return { CW, CH, source: 'hero.js fistBridgman + forearm(1.4), gesture ROTFRONT, camera 1.25 m, 30 deg, 16 deg below', cells };
};

async function setup() {
  if (!location.search) { window.sceneReady = true; return; }   // the bake page (sil_bake.mjs) calls window.fistBake itself
  SH = await S[SUBJ]();
  window.sceneReady = true;
}
window.renderFrame = t => { const t0 = performance.now(); const info = SH(t) || {}; info.subject = SUBJ; info.frame_ms = Math.round(performance.now() - t0); window.labInfo = info; return info; };
setup().catch(e => { console.error(e.stack || e.message); window.sceneError = String(e.message); });
