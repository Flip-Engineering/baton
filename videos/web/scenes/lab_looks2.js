// LAB / LOOKS c2: the looks reel for cycle 2 (videos/review/studio_looks_c2/before/NOTES.md).
//   ?subject=close|mid|far &mode=raw|KLUTSIS|SERIGRAPH|... [&ladder=0 (c1 semantics)] [&clip=squeegee|klutsis &hit=S &t0=S]
// window.renderFrame(t) draws into #out and returns measurements (window.labInfo).
//
// What is new here, against HUMAN c3's lab_folk crowds:
//  1. LAYOUTS, not a parade ground. The ranks are laid on authored foot lines (a Klutsis receding diagonal, a Deineka
//     two-tier with a crossing diagonal rank), heights vary per figure, the gestures are budgeted, the poles make the
//     diagonals, and the empty top half carries a type slot (and in the far shot the c1 hammer hand cuts the sky).
//  2. CARDS. The crowd is composed ONCE per shot and state (stand / fists up) into per-rank layers plus per-rank aux
//     stamps; a frame is the ranks moved as cards (sway, a counter-drift between the tiers, the fists switching on the
//     onset) and a camera push. A crowd frame costs the look plus a few drawImage calls, not the 6-14 s compose.
//  3. The looks read the rank ladder (source({ ranks, sky: 'designed' })): value per rank in the look's own medium,
//     a carved gap only where a nearer figure overlaps a farther one, one flat ground, the designed sky.
import { Ranks, feedCheck } from '../lib/fx/ranks.js';
import { Looks } from '../lib/fx/looks.js';
import { Stage, KITS } from '../lib/fx/folk_worlds.js';
import { loadFonts } from '../lib/kit.js';
import * as THREE from 'three';

const Q = new URLSearchParams(location.search);
const SUBJ = Q.get('subject') || 'mid', CLIP = Q.get('clip'), LADDER = Q.get('ladder') !== '0';
let MODE = Q.get('mode') || 'raw';
const W = 1080, H = 1920, AW = 540, AH = 960;
const out = document.getElementById('out'), ctx = out.getContext('2d');
const mk = (w = W, h = H) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const col = mk(), cg = col.getContext('2d'), shape = mk(), sg = shape.getContext('2d'), typeC = mk(), tg = typeC.getContext('2d');
const auxC = mk(AW, AH), ag = auxC.getContext('2d', { willReadFrequently: true });
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const lerp = (a, b, u) => a + (b - a) * u, clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
window.labInfo = {};

// ---------------------------------------------------------------- the sky and ground plate (raw colour; the looks reprint it)
function sky(g, sun, { top = '#1a0c12', mid = '#6a2012', hor = '#e0703a', horY = 1000, r = 160 } = {}) {
  const gr = g.createLinearGradient(0, 0, 0, horY); gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, hor);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffd89a'; g.beginPath(); g.arc(sun[0], sun[1], r, 0, Math.PI * 2); g.fill();
  sg.clearRect(0, 0, W, H); sg.fillStyle = '#fff'; sg.beginPath(); sg.arc(sun[0], sun[1], r, 0, Math.PI * 2); sg.fill();
}
// the ground: ONE flat value (lit dust), no comb of cast shadows; each rank stands on a solid contact band (drawn by
// the rank card itself, so it moves with it). poly: the ground's top edge [[x, y], ...] (an embankment, a slope)
function ground(g, poly, c = '#b85a2a') {
  g.fillStyle = c; g.beginPath(); g.moveTo(0, H); for (const [x, y] of poly) g.lineTo(x, y); g.lineTo(W, H); g.closePath(); g.fill();
}
function typeSlot(text, { x = 70, y = 330, size = 190, rot = 0, lines = null } = {}) {
  tg.clearRect(0, 0, W, H); if (!text) return;
  tg.save(); tg.translate(x, y); tg.rotate(rot); tg.fillStyle = '#000'; tg.textBaseline = 'alphabetic';
  (lines || [text]).forEach((s, i) => { let sz = size; tg.font = `${sz}px Anton`; while (tg.measureText(s).width > W - 2 * x && sz > 40) { sz -= 4; tg.font = `${sz}px Anton`; } tg.fillText(s, 0, i * size * 1.02); });
  tg.restore();
}

// ---------------------------------------------------------------- layouts: foot lines as polylines, heights along them
// rank spec: { line: [[x, y, h], ...] (foot y and figure height at x), pack, rows, raise, flags, tools, walk, flip, kinds, var }
// Figures are packed shoulder to shoulder by the LOCAL height (the diagonal recedes without gaps), the heights vary
// (var: +-share, a few tall), gestures are budgeted per rank, and cards carry a solid contact band.
function along(line, x) { let a = line[0], b = line[line.length - 1];
  for (let i = 0; i < line.length - 1; i++) if (x >= line[i][0] && x <= line[i + 1][0]) { a = line[i]; b = line[i + 1]; break; }
  const u = clamp((x - a[0]) / Math.max(1, b[0] - a[0])); return [lerp(a[1], b[1], u), lerp(a[2], b[2], u)]; }
function layout(R, seed, ranks) {
  const r = rng(seed * 7919 + 3), S = R.sil, crowd = { ranks: [], seed, hitT: null };
  ranks.forEach((spec, ri) => {
    if (spec.draw) { crowd.ranks.push({ spec: { foot: spec.foot, h: spec.h, draw: spec.draw }, figs: [], i: ri, custom: spec.draw }); return; }
    const figs = [], rows = spec.rows ?? 1, pack = spec.pack ?? 1.3, used = new Set();
    const x0 = spec.line[0][0], x1 = spec.line[spec.line.length - 1][0];
    for (let row = 0; row < rows; row++) {
      let x = x0 + r() * 20 + (row % 2) * 12;
      while (x < x1) {
        const [fy, fh] = along(spec.line, x), kh = 1 - row * 0.1, hRow = fh * kh;
        const sw = 0.26 * hRow / pack;
        if (r() < (spec.gaps ?? 0.05)) { x += sw * (1 + 1.2 * r()); continue; }
        const type = S.pick(r, { kinds: spec.kinds, not: used }); used.add(type); if (used.size > 20) used.clear();
        const ty = S.types[type], tall = r() < 0.08 ? 1.14 : 1, hv = (1 + (r() - 0.5) * 2 * (spec.var ?? 0.09)) * tall;
        figs.push({ rank: ri, row, type, x: x + (r() - 0.5) * sw * 0.3, y: fy - row * 0.1 * fh + (r() - 0.5) * 0.05 * fh, h: hRow * (ty.h / 1.78) * hv,
          flip: spec.flip != null ? (r() < 0.8 ? spec.flip : !spec.flip) : r() < 0.5, act: spec.walk ? 'walk' : 'stand', ph: r(), seed: r(), val: r(), acc: 1, stride: 1.05 + 0.1 * r() });
        x += sw * (0.72 + 0.46 * r());
      }
    }
    const order = figs.map((_, i) => i).sort(() => r() - 0.5);
    let nf = spec.flags || 0, nt = Math.round((spec.tools || 0) * figs.length), nr = Math.round((spec.raise || 0) * figs.length);
    for (const i of order) { const f = figs[i];
      if (nf > 0 && f.x > 0.06 * W && f.x < 0.94 * W && f.row === 0) { f.act = 'flag'; f.flagSeed = r(); nf--; continue; }
      if (nt > 0) { f.act = 'tool'; f.tool = r() < 0.6 ? 'sledge' : 'shovel'; nt--; continue; }
      if (nr > 0) { f.raise = true; f.fist = ['pumpHi', 'overhead', 'pumpLo'][Math.floor(r() * 3)]; if (!spec.walk) f.act = 'raise'; nr--; continue; }
      if (spec.strike && r() < spec.strike) f.striker = true;                    // stands now, answers the hit with a fist
    }
    figs.sort((a, b) => a.y - b.y);
    const ys = spec.line.map(p => p[1]), hs = spec.line.map(p => p[2]);
    crowd.ranks.push({ spec: { foot: Math.max(...ys), h: hs.reduce((a, b) => a + b) / hs.length, line: spec.line, band: spec.band ?? true }, figs, i: ri });
  });
  return crowd;
}

// ---------------------------------------------------------------- the shots
let R = null, lk = null, SHOT = null;
const SH = {};
SH.close = async () => {
  const sun = [430, 700], hz = 1010;
  const st = new Stage({ W, H }); await st.init();
  const backs = await KITS.backs(st, { sun2d: sun, strike: Q.get('hit') ? { onset: +Q.get('hit') } : null });
  // a Klutsis receding diagonal: the mass climbs from the hero's shoulder to the upper right, so the crowd fills the
  // frame's middle band instead of a strip at the horizon; three ranks, never a continuous field
  const crowd = layout(R, +(Q.get('seed') || 11), [
    { foot: 2300, h: 1300, draw: t => backs.draw(t) },
    { line: [[-60, 1470, 300], [540, 1330, 230], [1140, 1190, 170]], pack: 1.2, raise: 0.22, flags: 2, tools: 0.14, strike: 0.5, var: 0.1 },
    { line: [[-60, 1215, 128], [1140, 1030, 70]], pack: 1.35, rows: 2, raise: 0.25, flags: 3, tools: 0.08, var: 0.1 },
    { line: [[-60, 1060, 52], [1140, 950, 30]], pack: 1.5, rows: 2, raise: 0.2, flags: 2, var: 0.08 },
  ]);
  // c2b: the hero LIT (the look prints its tone): the same pose rendered again under a key from the upper left and a
  // warm fill, read as luma by the look; the rim render stays the colour source
  const key = new THREE.DirectionalLight('#ffffff', 0), fill = new THREE.HemisphereLight('#ffffff', '#40302a', 0);
  key.position.set(-3, 4, 4); st.scene.add(key); st.scene.add(fill);
  const tone = t => { backs.draw(t); key.intensity = 2.6; fill.intensity = 0.55; const c = mk(); c.getContext('2d').drawImage(st.renderLit(), 0, 0); key.intensity = 0; fill.intensity = 0; return c; };
  return { crowd, sun, hz, heroCache: true, tone, back: g => { sky(g, sun, { horY: hz, r: 150 }); ground(g, [[0, 1080], [1080, 960]]); },
    type: ['ALL TOGETHER!', { x: 64, y: 300, size: 200, lines: ['ALL', 'TOGETHER!'] }], gestures: () => backs.gestures(), backs };
};
SH.mid = async () => {
  // Deineka's two tiers: an upper tier marching on the embankment (walking), a lower tier with fists and sledges, and
  // a rank on the diagonal between them that crosses both horizontals; the poles are the rifles' diagonals
  const sun = [760, 780], hz = 1000;
  const crowd = layout(R, +(Q.get('seed') || 4), [
    { line: [[-60, 1760, 360], [1140, 1700, 330]], pack: 1.25, raise: 0.3, tools: 0.2, flags: 1, strike: 0.6, var: 0.1 },
    { line: [[-60, 1480, 170], [1140, 1180, 120]], pack: 1.3, rows: 2, raise: 0.2, flags: 2, tools: 0.12, var: 0.1 },
    { line: [[-60, 1062, 96], [1140, 1062, 96]], pack: 1.3, walk: true, flip: true, flags: 3, raise: 0.12, var: 0.07 },
    { line: [[-60, 1000, 38], [1140, 985, 32]], pack: 1.6, rows: 2, raise: 0.18, flags: 2, var: 0.06 },
  ]);
  return { crowd, sun, hz, back: g => { sky(g, sun, { horY: hz, r: 130 }); ground(g, [[0, 1000], [1080, 990]]); },
    type: ['EVERYBODY!', { x: 60, y: 420, size: 230 }] };
};
SH.far = async () => {
  // the Klutsis scale collision: the c1 hammer hand (a real hand, not the mitten) at monument scale cuts the sky over
  // a mass of hundreds laid on a diagonal horizon
  const sun = [300, 820], hz = 1260;
  // c2b: the hand is the HUMAN lab's LIT render (lab_human.html?subject=hand&mode=lit, a key from the front-left), so
  // the looks print a real modelled form - knuckles, the grip, the round handle - instead of an inflated silhouette.
  // Mirrored so the head swings up-right, clear of the words, whole inside the frame. The raw colour is it at dusk.
  const hl = await loadImg('../assets/looks_src/hand/lit_color.jpg');
  const hp = (Q.get('hand') || '0,250,1').split(',').map(Number);
  const hand = mk(), hg = hand.getContext('2d'), toneF = mk(), tfg = toneF.getContext('2d');
  { const m = mk(), mg = m.getContext('2d', { willReadFrequently: true }); mg.drawImage(hl, 0, 0, W, H); const D = mg.getImageData(0, 0, W, H);
    for (let i = 0; i < W * H; i++) { const l = D.data[i * 4] * 0.3 + D.data[i * 4 + 1] * 0.59 + D.data[i * 4 + 2] * 0.11; D.data[i * 4 + 3] = l > 7 ? 255 : 0; }
    mg.putImageData(D, 0, 0);
    const place = g => { g.save(); g.translate(W + hp[0], hp[1]); g.scale(-hp[2], hp[2]); g.drawImage(m, 0, 0); g.restore(); };
    place(tfg);                                                                   // the tone: the lit render itself
    const d = mk(), dg = d.getContext('2d'); place(dg); dg.globalCompositeOperation = 'source-atop'; dg.fillStyle = 'rgba(40,12,6,0.72)'; dg.fillRect(0, 0, W, H);
    hg.drawImage(d, 0, 0); }
  const crowd = layout(R, +(Q.get('seed') || 7), [
    { foot: 2400, h: 1500, draw: () => hand },
    { line: [[-60, 1650, 78], [1140, 1470, 58]], pack: 1.3, rows: 2, raise: 0.3, flags: 3, strike: 0.5, var: 0.1 },
    { line: [[-60, 1470, 48], [1140, 1360, 36]], pack: 1.45, rows: 2, raise: 0.25, flags: 3, var: 0.08 },
    { line: [[-60, 1360, 30], [1140, 1290, 22]], pack: 1.6, rows: 2, raise: 0.18, flags: 2, var: 0.07 },
    { line: [[-60, 1290, 19], [1140, 1250, 15]], pack: 1.8, rows: 2, raise: 0.12, var: 0.06 },
  ]);
  return { crowd, sun, hz, back: g => { sky(g, sun, { horY: hz, r: 110, top: '#12080e' }); ground(g, [[0, 1300], [1080, 1250]]); },
    type: ['HUMAN POWER.', { x: 60, y: 260, size: 170, lines: ['HUMAN', 'POWER.'] }], tone: () => toneF };
};

// ---------------------------------------------------------------- cards: compose once per state, then move the ranks
class Cards {
  constructor(R, shot) { this.R = R; this.shot = shot; this.states = {}; this.base = null; }
  // compose `state` ('stand' | 'up') once: per-rank colour layers (with their contact band) and aux stamps
  build(state) {
    const R = this.R, { crowd } = this.shot, nR = crowd.ranks.length, t0 = performance.now();
    for (const Rk of crowd.ranks) for (const f of Rk.figs) {
      if (f._act == null) f._act = f.act;
      f.act = state === 'up' && f.striker ? 'raise' : f._act; if (state === 'up' && f.striker) f.fist ||= 'pumpHi';
    }
    const tmp = mk(), g = tmp.getContext('2d');
    const res = R.compose(g, crowd, 0.5, { back: null, sun: this.shot.sun, style: 'dusk', ground: false, shadowAmt: 0, gap: false });
    const dOf = ri => 0.12 + 0.62 * ri / Math.max(1, nR - 1);
    const layers = [], stamps = [];
    for (let ri = 0; ri < nR; ri++) { const L = res.layers[ri]; if (!L) continue;
      const Rk = crowd.ranks[ri], c = mk(), cgc = c.getContext('2d');
      if (Rk.spec.band && Rk.figs.length) { // the contact band: one solid strip under the rank's feet (no comb of shadows)
        cgc.fillStyle = '#1a0906'; cgc.beginPath(); const ln = Rk.spec.line, th = p => Math.max(3, p[2] * 0.035);
        cgc.moveTo(ln[0][0], ln[0][1] - th(ln[0]) * 0.4); for (const p of ln) cgc.lineTo(p[0], p[1] - th(p) * 0.4);
        for (const p of [...ln].reverse()) cgc.lineTo(p[0], p[1] + th(p)); cgc.closePath(); cgc.fill(); }
      cgc.drawImage(L.canvas, 0, 0);
      const figs = mk(); figs.getContext('2d').drawImage(L.figs, 0, 0);
      const flags = L.flags ? (() => { const f = mk(); f.getContext('2d').drawImage(L.flags, 0, 0); return f; })() : null;
      layers[ri] = { canvas: c, figs, flags, foot: L.foot, h: L.h };
      // aux stamp at aux res: figure / flag texels carry this rank's flat depth and class; clear elsewhere
      const s = mk(AW, AH), sgc = s.getContext('2d', { willReadFrequently: true }), D = sgc.createImageData(AW, AH), l = Math.round(65534 * dOf(ri));
      const tc = mk(AW, AH), tcg = tc.getContext('2d', { willReadFrequently: true });
      for (const [cv, cls] of [[figs, 255], [flags, 180]]) { if (!cv) continue; tcg.clearRect(0, 0, AW, AH); tcg.drawImage(cv, 0, 0, AW, AH); const A = tcg.getImageData(0, 0, AW, AH).data;
        for (let j = 0; j < AW * AH; j++) if (A[j * 4 + 3] > 110) { D.data[j * 4] = l >> 8; D.data[j * 4 + 1] = l & 255; D.data[j * 4 + 2] = cls; D.data[j * 4 + 3] = 255; } }
      sgc.putImageData(D, 0, 0); stamps[ri] = s;
    }
    if (!this.base) { const b = R.aux(crowd, [], res.groundY); this.base = mk(AW, AH); this.base.getContext('2d').drawImage(b, 0, 0); this.gy0 = res.groundY; }
    this.states[state] = { layers, stamps, ms: performance.now() - t0 };
    return this.states[state];
  }
  // one frame: back, then the ranks far to near at their card offsets; the aux assembled the same way (nearest texels)
  frame(g, off, stateOf, heroCanvas = null) {
    const { crowd } = this.shot, nR = crowd.ranks.length;
    g.clearRect(0, 0, W, H); this.shot.back(g);
    ag.imageSmoothingEnabled = false; ag.globalCompositeOperation = 'copy'; ag.drawImage(this.base, 0, 0); ag.globalCompositeOperation = 'source-over';
    const used = [];
    for (let ri = nR - 1; ri >= 0; ri--) {
      const S = this.states[stateOf(ri)] || this.states.stand, L = S.layers[ri]; if (!L) continue;
      const [dx, dy] = off[ri] || [0, 0], ax = Math.round(dx / 2), ay = Math.round(dy / 2);
      if (heroCanvas && crowd.ranks[ri].custom) { g.drawImage(heroCanvas, dx, dy); } else g.drawImage(L.canvas, ax * 2, ay * 2);
      ag.drawImage(S.stamps[ri], ax, ay);
      used[ri] = L;
    }
    return used;
  }
}

// ---------------------------------------------------------------- run
let cards = null;
async function setup() {
  await loadFonts();
  R = await Ranks.create({ W, H });
  R.emblem = await loadImg('../assets/acp_mark.png');
  SHOT = await SH[SUBJ]();
  if (MODE !== 'raw') lk = new Looks();
  cards = new Cards(R, SHOT);
  const t0 = performance.now();
  cards.build('stand'); if (CLIP) cards.build('up');
  window.labInfo.compose_once_ms = Math.round(performance.now() - t0);
  typeSlot(...SHOT.type);
  window.sceneReady = true;
}

// the cards' motion: every rank sways on twos with its own phase; the two tiers drift against each other (Deineka's
// counter-march); a slow camera push on ones. Returns per-rank [dx, dy] (px) and the zoom.
function motion(t, still) {
  if (still) return { off: [], zoom: [1, 0, 0] };
  const tq = Looks.twos(t), nR = SHOT.crowd.ranks.length, off = [];
  // c2b: a multiplane truck (Norstein): every card moves at its depth's rate, the near rank ~5% of the frame over 2 s,
  // the far ranks a fraction of that, plus the old sway on twos; the camera pushes 3% over 2 s on ones
  const t0 = +(Q.get('t0') || 0), u = t - t0, PAR = [1, 0.5, 0.3, 0.17, 0.1];
  for (let ri = 0; ri < nR; ri++) { const a = [9, 6, 4, 3, 2][ri] || 2;
    off[ri] = [-50 * u * (PAR[ri] ?? 0.08) + a * Math.sin(tq * 5.1 + ri * 1.7), 4 * u * (PAR[ri] ?? 0.08) + a * 0.6 * Math.sin(tq * 7.3 + ri)]; }
  const hk = (t - +(Q.get('hit') || 99)) * 30, rel = hk > 0 ? 0.06 * (1 - Math.exp(-hk / 14)) : 0;   // c2b: the push releases on the hit (the follow-through moves)
  return { off, zoom: [1 + 0.06 * u / 2 + rel, 0, -0.008 * u - 0.01 * rel / 0.06] };
}
const heroCache = new Map(), toneCache = new Map(), toneC = mk(), toneG = toneC.getContext('2d');
function hero(t) { // the 3D hero backs: rendered per distinct pose frame (the fist wave only changes near the hit), cached
  if (!SHOT.backs) return null; const hit = +(Q.get('hit') || 99), k = Math.round((t - hit) * 30), key = k < -4 ? 'pre' : k > 12 ? 'post' + (Math.floor((k - 10) / 8) % 2) : 'k' + k;
  if (!heroCache.has(key)) heroCache.set(key, SHOT.backs.draw(t));
  return heroCache.get(key);
}

function renderFrame(t) {
  const still = !CLIP, t0 = performance.now(), hit = +(Q.get('hit') || 99);
  const { off, zoom } = motion(t, still);
  const k = Math.round((t - hit) * 30);
  const stateOf = ri => (!still && k >= 0 && ri <= 1) || (!still && k >= 2) ? 'up' : 'stand';   // the near ranks answer ON the hit
  const layers = cards.frame(cg, off, stateOf, SHOT.backs && !still ? hero(t) : null);
  if (SHOT.tone) { const key = still ? 'still' : (() => { const k = Math.round((t - hit) * 30); return k < -4 ? 'pre' : k > 12 ? 'post' + (Math.floor((k - 10) / 8) % 2) : 'k' + k; })();
    if (!toneCache.has(key)) toneCache.set(key, SHOT.tone(still ? 0.5 : t));
    toneG.clearRect(0, 0, W, H); const [dx, dy] = still ? [0, 0] : (off[0] || [0, 0]); toneG.drawImage(toneCache.get(key), dx, dy); }
  const info = { subject: SUBJ, mode: MODE, figures: SHOT.crowd.ranks.reduce((a, R) => a + R.figs.length, 0), compose_once_ms: window.labInfo.compose_once_ms };
  const tc = performance.now(); info.cards_ms = Math.round(tc - t0);
  if (MODE === 'raw') { ctx.drawImage(col, 0, 0); ctx.drawImage(typeC, 0, 0); }
  else {
    lk.source({ color: col, aux: auxC, shape, type: typeC, depth: [1, Math.E ** 4], tonal: LADDER ? [] : ['subject', 'ground'], rankCut: !LADDER,
      ranks: LADDER ? { n: SHOT.crowd.ranks.length } : null, sky: LADDER ? 'designed' : null, anchor: [SHOT.sun[0], SHOT.sun[1], 150],
      hero: Q.get('hero') === '0' ? false : { rank: SHOT.tone ? 0 : null, light: [-0.6, 0.55] },   /* c2b: the close man and the far hand are heroes; the mid crowd has none */ tone: SHOT.tone ? toneC : null }, { type: 1, tone: SHOT.tone ? null : 'none' });
    const o = { zoom, rankOff: off, fps: 30 };
    if (CLIP === 'squeegee') info.phase = lk.event(ctx, 'SERIGRAPH', t, { ...o, hitT: hit, from: Q.get('from') || 'RISO', fromOpts: o }).phase;
    else if (CLIP === 'sodium') info.phase = lk.event(ctx, 'SODIUM', t, { ...o, hitT: hit, beam: JSON.parse(Q.get('beam') || '[560,1180,820,2]'), beamFrom: JSON.parse(Q.get('beamFrom') || '[-260,1500]'), antic: +(Q.get('antic') || 10) }).phase;   /* c2b: a searchlight on the crowd (floodlight mode) */
    else if (CLIP === 'klutsis') info.phase = lk.event(ctx, 'KLUTSIS', t, { ...o, hitT: hit, from: Q.get('from') || 'SODIUM', fromOpts: o, slideAt: +(Q.get('slide') || hit - 0.9), antic: +(Q.get('antic') || 12) }).phase;
    else lk.apply(ctx, MODE, t, o);
    info.look_ms = Math.round(performance.now() - tc);
  }
  if (Q.get('marker') && Math.round(t * 30) === Math.round(hit * 30)) { ctx.fillStyle = '#ff00ff'; ctx.fillRect(W - 64, 24, 40, 40); }
  if (still) Object.assign(info, feedCheck(out, layers, { exclude: SHOT.tone && layers[0] ? layers[0].figs : null }));   /* c2b: the designed hero is not slab */
  info.frame_ms = Math.round(performance.now() - t0);
  return info;
}
window.setMode = m => { MODE = m; if (m !== 'raw') lk ||= new Looks(); };
window.renderFrame = t => { const info = renderFrame(t); window.labInfo = info; return info; };
setup().catch(e => { console.error(e.stack || e.message); window.sceneError = String(e.message); });
