// UNRECOGNIZABLE (16 Oct 2026; research/pieces/UNRECOGNIZABLE.md). The Chairman, 4 Oct: AI is accelerating all fields of practical
// knowledge so fast the world will soon become unrecognizable; the last form of private property, intellectual property, stands in the
// way. 3 Oct: immediately abolish all intellectual property. The Program: the abolition of software patents and IP-based monopolies.
//
// The world is one drafting-room table seen from above, and the material is real engineering drawings (HAER/HABS measured drawings, Library
// of Congress, public domain: a steam engine, a water-wheel and its gear, a blast furnace, a powerhouse, a ship's engine, a truss bridge, a
// Model T) and real photographs of people building (NASA and the Highsmith archive, public domain).
//   0-22    one sheet, copied: a copier's light bar passes on each card and every copy comes out SHARPER and more complete than the last
//           (the opposite of a copy's generation loss). On UNRECOGNIZABLE. the camera falls back: it is one copy among many.
//   22-50   the copies spread across the table from the centre outward, faster and faster; the water-wheels on the sheets turn.
//   50-64   the list: each field a sheet, and the photograph of the people building from it lands on the sheet.
//   64-72   the whole table, everything moving.
//   72-88   THE LAST FORM OF PRIVATE PROPERTY: every sheet grows its title block (PROPRIETARY / DO NOT REPRODUCE ...) from the corner
//           until it covers the drawing; the wheels and the copies stop, the camera brakes with the music to a stall.
//   88      IMMEDIATELY ABOLISH: one cut across the frame, and the title blocks fall off every sheet at once.
//   88-117  the drawings go out into the world: the field races outward, faster than before (the Program over it).
//   116-120 the last sheet: the copier prints the Party's mark; the closer at beat 120.
// Everything is keyed to beats of the score's own tempo map (hits.beats; songs2/unrecognizable_e.py), so the picture accelerates,
// brakes and restarts with the music. Canvas 2D only. web/labs/unrecognizable_dry.mjs runs every frame's logic in node against stubs.
import { W, H, C, clamp, lerp, smooth, ease, hash01, closer, loadFonts, Beats } from '../lib/kit.js';
import { drawMark, markStroke } from '../lib/closer.js';

const A = new URL('../assets/unrecognizable/', import.meta.url).href;
const PAPER = '#f2f0e9', TABLE = '#191817', INK = '#141414';
const TAKE = globalThis.UNR_TAKE || 'a';             // take b: the list's people at nearly the frame's width, the sheet behind them
const SW = 1000;                                       // a sheet's width in world units
const KINDS = ['engine', 'wheel', 'furnace', 'power', 'valve', 'truss', 'auto'];
const WHEEL = { cx: 491 / 1600, cy: 339 / 1226, r: 293 / 1600 };   // the water-wheel on its sheet, as fractions of the sheet's width
// the copy generations of the first sheet: blur (px at 1600), haze, toner dropout, skew (rad), paper grey
const GENS = [
  { blur: 7.0, haze: 0.42, drop: 0.55, skew: 0.020, grey: 0.80 },
  { blur: 3.6, haze: 0.26, drop: 0.32, skew: 0.012, grey: 0.86 },
  { blur: 1.8, haze: 0.14, drop: 0.14, skew: 0.006, grey: 0.92 },
  { blur: 0.8, haze: 0.06, drop: 0.04, skew: 0.002, grey: 0.97 },
  { blur: 0.0, haze: 0.00, drop: 0.00, skew: 0.000, grey: 1.00 },
];
const BLOCK_ROWS = [['PROPRIETARY', 'DO NOT REPRODUCE'], ['CONFIDENTIAL', 'ALL RIGHTS RESERVED'], ['DWG NO.', 'PATENT PENDING'], ['LICENSED USE ONLY', 'UNAUTHORIZED COPYING PROHIBITED']];

export async function buildScene({ ctx, scene = 'unrecognizable', dry = false, env = {} }) {
  const mk = env.canvas || ((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
  const load = env.image || (src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('no ' + src)); i.src = src; }));
  const getJSON = env.json || (async u => (await fetch(u)).json());
  if (!dry) await loadFonts();
  const hits = await getJSON(`../../out/.${scene}.hits.json`);
  const B = new Beats(hits); B.bt = hits.hits.beats;   // the score's tempo map: B.time(beat) / B.beat(t) follow its accelerando and its brake
  const cards = (await getJSON(new URL('./unrecognizable.cards.json', import.meta.url).href));
  const BE = cards.beats, CUT = BE.cut, WALL = BE.wall, STALL = BE.stall, MARKB = BE.mark;
  const MARK = B.time(MARKB);

  // ---------------------------------------------------------------- the drawings and their copies
  const img = {};
  for (const k of KINDS) img[k] = await load(A + k + '.png');
  const photo = {};
  for (const k of ['p_metal', 'p_mech', 'p_eng', 'p_build', 'p_energy']) photo[k] = await load(A + k + '.jpg');

  function bake(k, g, w) {                              // one copy generation of a drawing, on paper, at width w
    const I = img[k], h = Math.round(w * I.height / I.width), c = mk(w, h), x = c.getContext('2d');
    const s = w / 1600, grey = Math.round(242 * g.grey), gb = Math.round(233 * g.grey);
    x.fillStyle = `rgb(${grey},${Math.round(240 * g.grey)},${gb})`; x.fillRect(0, 0, w, h);
    x.save(); x.globalCompositeOperation = 'multiply';
    if (g.blur > 0) x.filter = `blur(${(g.blur * s).toFixed(2)}px)`;
    x.translate(w / 2, h / 2); x.rotate(g.skew); x.drawImage(I, -w / 2, -h / 2, w, h); x.restore(); x.filter = 'none';
    if (g.drop > 0) {                                   // toner dropout: blocks of the copy that did not come through
      const bs = Math.round(110 * s * 1.6); x.fillStyle = `rgb(${grey},${Math.round(240 * g.grey)},${gb})`;
      for (let yy = 0, j = 0; yy < h; yy += bs, j++) for (let xx = 0, i = 0; xx < w; xx += bs, i++) {
        const hsh = hash01(i * 7919 + j * 104729 + k.length * 31);
        if (hsh < g.drop) { x.globalAlpha = 0.55 + 0.45 * hash01(i * 13 + j * 17); x.fillRect(xx, yy, bs * (1 + (hsh < g.drop * 0.3 ? 1 : 0)), bs); }
      }
      x.globalAlpha = 1;
    }
    if (g.haze > 0) { x.fillStyle = `rgba(${grey},${Math.round(240 * g.grey)},${gb},${g.haze})`; x.fillRect(0, 0, w, h); }
    if (g.grey < 1) {                                   // copier speckle
      x.fillStyle = 'rgba(20,20,20,0.5)';
      const n = Math.round(1400 * (1 - g.grey) * 10 * s);
      for (let i = 0; i < n; i++) { const r = 0.6 + 1.6 * hash01(i * 3 + 11); x.fillRect(hash01(i * 5 + 1) * w, hash01(i * 7 + 2) * h, r, r); }
    }
    return c;
  }
  const SH = {};                                        // per kind: full (1600) crisp and soft, and mips
  for (const k of KINDS) {
    SH[k] = { ar: img[k].height / img[k].width, crisp: bake(k, GENS[4], 1600), soft: bake(k, GENS[1], 800), mid: bake(k, GENS[4], 520), lo: bake(k, GENS[4], 200), los: bake(k, GENS[1], 200) };
  }
  const HERO = GENS.map(g => bake('engine', g, 1300));

  // ---------------------------------------------------------------- the table: a jittered grid of sheets, the hero at the centre
  const sheets = [];
  const CW = 1180, CH = 1560;
  for (let j = -13; j <= 13; j++) for (let i = -12; i <= 12; i++) {
    const h0 = hash01(i * 92821 + j * 68917 + 5);
    const d = Math.hypot(i, j * 0.85) + 0.35 * h0;
    let kind = KINDS[Math.floor(hash01(i * 31 + j * 57 + 3) * KINDS.length)];
    if (i === 0 && j === 0) kind = 'engine';
    const inner = d <= 6.2;
    const appear = i === 0 && j === 0 ? -99 : inner ? 16 + 2.0 * Math.pow(Math.max(0, d - 0.6), 1.3) : CUT + 1 + (d - 6.2) * 2.4;   // a burst from the first copy, then faster
    const o = i || j ? 1 : 0;
    sheets.push({ i, j, d, kind, x: i * CW + o * (hash01(i * 3 + j * 11) - 0.5) * 140, y: j * CH + o * (hash01(i * 17 + j * 5) - 0.5) * 160,
      rot: i === 0 && j === 0 ? 0 : (hash01(i * 7 + j * 13) - 0.5) * 0.09, appear, scan: 1.1 + 0.4 * h0, from: (hash01(i * 23 + j * 29) - 0.5),
      block0: WALL + 0.6 * Math.min(d, 7) * hash01(i + j * 9 + 2), spin: hash01(i * 101 + j * 7) < 0.5 ? 1 : -1, fall: hash01(i * 41 + j * 43) });
  }
  sheets.sort((a, b) => b.d - a.d);                    // far first, the centre on top
  const byIJ = (i, j) => sheets.find(s => s.i === i && s.j === j);
  // the list's sheets (one per field) and the photographs that land on them
  const LIST = [
    { beat: 50, i: 2, j: -1, kind: 'furnace', ph: 'p_metal' },
    { beat: 52, i: -2, j: 1, kind: 'valve', ph: 'p_mech' },
    { beat: 54, i: 1, j: 2, kind: 'wheel', ph: 'p_eng' },
    { beat: 57, i: -1, j: -2, kind: 'truss', ph: 'p_build' },
    { beat: 59, i: 3, j: 1, kind: 'auto', ph: null },
    { beat: 61, i: -3, j: -1, kind: 'power', ph: 'p_energy' },
  ];
  const prints = [];
  for (const L of LIST) {
    const s = byIJ(L.i, L.j); s.kind = L.kind; L.s = s;
    if (L.ph) prints.push(TAKE === 'b' ? { img: photo[L.ph], s, beat: L.beat + 0.12, ox: 40, oy: 520, rot: (hash01(L.i * 9 + L.j) - 0.5) * 0.06, w: 1420 }
                         : { img: photo[L.ph], s, beat: L.beat + 0.15, ox: 120, oy: 300, rot: (hash01(L.i * 9 + L.j) - 0.5) * 0.16, w: 760 });
  }
  // a few more prints in the field (from the whole-table pull back on)
  [[4, -3, 'p_build'], [-4, 3, 'p_metal'], [5, 2, 'p_energy'], [-5, -2, 'p_eng'], [0, 4, 'p_mech'], [2, -5, 'p_metal'], [-3, 5, 'p_energy']].forEach(([i, j, k], n) => {
    const s = byIJ(i, j); prints.push({ img: photo[k], s, beat: 64 + n * 0.5, ox: -100 + 200 * hash01(n), oy: 200, rot: (hash01(n * 5) - 0.5) * 0.3, w: 820 });
  });

  // ---------------------------------------------------------------- motion integrated over beats: the wheels' angle and the camera's travel
  const RES = 0.05, NB = Math.ceil((MARKB + 8) / RES);
  const wheelSpeed = b => b < 16 ? 0.12 : b < WALL + 2 ? 0.22 + 0.25 * (b - 16) / (WALL - 14) : b < CUT ? 0.47 * (1 - smooth(WALL + 2, 84, b)) : 0.9;
  const phi = new Float32Array(NB + 1);
  for (let n = 1; n <= NB; n++) phi[n] = phi[n - 1] + wheelSpeed((n - 0.5) * RES) * RES * Math.PI;
  const angle = b => { const u = clamp(b / RES, 0, NB - 1), n = Math.floor(u); return phi[n] + (phi[n + 1] - phi[n]) * (u - n); };

  function camAt(b) {                                   // the camera: world point at the frame's centre of view, zoom, roll
    const focus = (s, z) => ({ x: s.x, y: s.y + SW * SH[s.kind].ar * 0.08, z, r: -s.rot });
    if (b < 22) {                                      // from exactly where the copied sheet lay (frame(): HERO), falling back
      const z0 = 0.96 + 0.006 * 16, cy = 560 + SW * SH.engine.ar * z0 / 2 + 10, y0 = -(cy - VY) / z0;
      const u = ease.outCubic(clamp((b - 16) / 6)); return { x: 0, y: lerp(y0, 0, u), z: z0 * Math.pow(0.30 / z0, u), r: lerp(0, -0.06, u) };
    }
    if (b < 44) { const u = (b - 22) / 22; return { x: 300 * Math.sin(u * 2), y: 200 * u, z: 0.30 * Math.pow(0.42, u), r: -0.06 + 0.16 * u }; }
    if (b < 50) { const u = (b - 44) / 6; return { x: lerp(300 * Math.sin(2), 0, ease.inOutCubic(u)), y: lerp(200, 0, ease.inOutCubic(u)), z: lerp(0.126, 0.20, ease.inOutCubic(u)), r: lerp(0.10, 0.02, u) }; }
    if (b < 64) {                                      // the list: cut to each field's sheet, a slow push in
      let L = LIST[0]; for (const l of LIST) if (b >= l.beat) L = l;
      const nx = LIST[LIST.indexOf(L) + 1], end = nx ? nx.beat : 64, u = (b - L.beat) / (end - L.beat);
      const f = focus(L.s, 0.58 + 0.08 * u); f.y += 120;
      if (TAKE === 'b' && L.ph) { f.y += 250; f.z = 0.60 + 0.06 * u; }        // the camera favours the photograph, the drawing above it
      return f;
    }
    if (b < WALL) { const u = ease.outCubic((b - 64) / 8); const f = focus(LIST[5].s, 0.66); f.y += 120; return { x: lerp(f.x, 0, u), y: lerp(f.y, 0, u), z: 0.66 * Math.pow(0.13 / 0.66, u), r: lerp(f.r, 0.08, u) }; }
    if (b < CUT) {                                     // the brake: the drift slows to nothing at the stall
      const v = 1 - Math.pow(1 - clamp((b - WALL) / (STALL - WALL)), 2);
      return { x: 0, y: 0, z: 0.13 + 0.035 * v, r: 0.08 - 0.02 * v };
    }
    const u = clamp((b - CUT) / (MARKB - CUT));          // after the cut: out into the world, faster and faster
    return { x: 0, y: 0, z: 0.165 * Math.pow(0.30, Math.pow(u, 1.2)), r: 0.06 - 0.6 * u * u };
  }

  // ---------------------------------------------------------------- drawing helpers
  const VY = 1150;                                     // the frame's centre of view (the words sit above it)
  function toScreen(Cm, x, y) {
    const dx = x - Cm.x, dy = y - Cm.y, c = Math.cos(Cm.r), s = Math.sin(Cm.r);
    return [W / 2 + (dx * c - dy * s) * Cm.z, VY + (dx * s + dy * c) * Cm.z];
  }
  function lightBar(g, w, y, a) {                      // the copier's light passing under the glass
    g.save(); g.globalCompositeOperation = 'lighter';
    const L = 70, gr = g.createLinearGradient(0, y - L, 0, y + L * 0.3);
    gr.addColorStop(0, 'rgba(150,220,255,0)'); gr.addColorStop(0.8, `rgba(170,230,255,${0.45 * a})`); gr.addColorStop(1, 'rgba(170,230,255,0)');
    g.fillStyle = gr; g.fillRect(-w / 2 - 8, y - L, w + 16, L * 1.3);
    g.fillStyle = `rgba(235,250,255,${0.95 * a})`; g.fillRect(-w / 2 - 8, y - 2.5, w + 16, 5);
    g.restore();
  }
  function blockDraw(g, w, h, gr, alpha = 1) {        // the title block at growth gr (0 none, 1 the whole sheet), anchored bottom-right
    if (gr <= 0) return;
    const bw = w * lerp(0.36, 1, gr), bh = h * lerp(0.13, 1, gr);
    const x0 = w / 2 - bw, y0 = h / 2 - bh;
    g.save(); g.globalAlpha *= alpha;
    g.fillStyle = '#e9e6dc'; g.fillRect(x0, y0, bw, bh);
    const lw = Math.max(1.2, bw * 0.006);
    g.strokeStyle = INK; g.lineWidth = lw * 1.8; g.strokeRect(x0 + lw, y0 + lw, bw - 2 * lw, bh - 2 * lw);
    const rows = BLOCK_ROWS.length, rh = bh / rows;
    g.lineWidth = lw;
    for (let r = 1; r < rows; r++) { g.beginPath(); g.moveTo(x0, y0 + r * rh); g.lineTo(x0 + bw, y0 + r * rh); g.stroke(); }
    const cx = x0 + bw * 0.42; g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y0 + bh); g.stroke();
    const T = g.getTransform(), scr = Math.hypot(T.a, T.b) * rh;       // the row's height on screen
    if (scr > 9) {
      g.fillStyle = INK; g.textBaseline = 'middle';
      for (let r = 0; r < rows; r++) {
        const [a, b] = BLOCK_ROWS[r];
        const big = r === 0;
        let fs = rh * (big ? 0.5 : 0.36);
        g.font = `${big ? '' : ''}${Math.round(fs)}px "${big ? 'Archivo Black' : 'Plex Mono'}"`;
        let tw = g.measureText(a).width; if (tw > bw * 0.38) { fs *= bw * 0.38 / tw; g.font = `${fs}px "${big ? 'Archivo Black' : 'Plex Mono'}"`; }
        g.textAlign = 'left'; g.fillText(a, x0 + bw * 0.025, y0 + (r + 0.5) * rh);
        let fs2 = rh * (big ? 0.5 : 0.30); g.font = `${fs2}px "${big ? 'Archivo Black' : 'Plex Mono'}"`;
        tw = g.measureText(b).width; if (tw > bw * 0.54) { fs2 *= bw * 0.54 / tw; g.font = `${fs2}px "${big ? 'Archivo Black' : 'Plex Mono'}"`; }
        g.fillText(b, cx + bw * 0.025, y0 + (r + 0.5) * rh);
      }
    }
    g.restore();
  }
  function sheetImage(s, scr, crisp) {
    const S = SH[s.kind];
    if (scr > 700) return crisp ? S.crisp : S.soft;
    if (scr > 230) return crisp ? S.mid : S.soft;
    return crisp ? S.lo : S.los;
  }
  function drawSheet(g, Cm, s, b, opt) {
    const w = SW, h = SW * SH[s.kind].ar;
    let a = s.appear;
    if (b < a) return;
    const age = b - a;
    // arrival: the copy slides in from the copier's side, 0.6 beats
    const k = ease.outCubic(clamp(age / 0.6));
    const [sx, sy] = toScreen(Cm, s.x + (1 - k) * s.from * 900, s.y + (1 - k) * 700);
    const z = Cm.z, scrW = w * z;
    if (sx + scrW < -200 || sx - scrW > W + 200 || sy + h * z < -300 || sy - h * z > H + 300) return;
    g.save(); g.translate(sx, sy); g.rotate(Cm.r + s.rot); g.scale(z, z);
    g.globalAlpha = clamp(age / 0.25);
    g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(-w / 2 + 14, -h / 2 + 18, w, h);       // its shadow on the table
    // the copy: soft above the light bar, crisp below it (the bar passes once as it arrives)
    const sc = s.scan, p = clamp((age - 0.15) / sc), stop = opt.freezeScan;
    const pp = stop != null && b > stop ? clamp((stop - a - 0.15) / sc) : p;
    const crisp = sheetImage(s, scrW, true), soft = sheetImage(s, scrW, false);
    if (pp >= 1) g.drawImage(crisp, -w / 2, -h / 2, w, h);
    else {
      g.drawImage(soft, -w / 2, -h / 2, w, h);
      const yb = -h / 2 + h * pp;
      g.save(); g.beginPath(); g.rect(-w / 2, -h / 2, w, h * pp); g.clip(); g.drawImage(crisp, -w / 2, -h / 2, w, h); g.restore();
      if (scrW > 40) lightBar(g, w, yb, 1);
    }
    if (s.kind === 'wheel' && scrW > 60) wheelTurn(g, w, h, b, crisp);
    // the title block
    const gr = opt.block(s, b);
    if (gr > 0) {
      if (b < CUT) blockDraw(g, w, h, gr);
      else {                                            // cut: it falls away from the sheet, with a bright edge where the blade went
        const tc = B.time(b) - B.time(CUT);
        if (tc < 1.6) {
          g.save(); const fy = 0.5 * 9000 * tc * tc * (0.7 + 0.6 * s.fall), fx = s.spin * 600 * tc;
          g.translate(fx, fy); g.rotate(s.spin * tc * (1.2 + s.fall)); blockDraw(g, w, h, 1, clamp(1 - tc / 1.6));
          g.restore();
          if (tc < 0.18) { g.fillStyle = `rgba(255,250,235,${1 - tc / 0.18})`; g.fillRect(-w / 2, -h / 2 - 6, w, 12); g.fillRect(-w / 2 - 6, -h / 2, 12, h); }
        }
      }
    }
    g.restore();
  }
  function wheelTurn(g, w, h, b, crisp) {             // the water-wheel on its sheet turns (its drawn disc, rotated about the axle)
    const cx = -w / 2 + WHEEL.cx * w, cy = -h / 2 + WHEEL.cy * h, r = WHEEL.r * w;
    const th = angle(b);
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    g.fillStyle = PAPER; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    g.translate(cx, cy); g.rotate(th); g.drawImage(crisp, -w / 2 - (cx), -h / 2 - (cy), w, h);
    g.restore();
  }
  function drawPrint(g, Cm, P, b, opt) {
    if (b < P.beat) return;
    const age = b - P.beat, k = ease.outBack(clamp(age / 0.5));
    const hgt = P.w * P.img.height / P.img.width;
    const s = P.s, [sx, sy] = toScreen(Cm, s.x + P.ox, s.y + P.oy + (1 - k) * 900);
    const z = Cm.z;
    if (sx + P.w * z < -100 || sx - P.w * z > W + 100 || sy + hgt * z < -200 || sy - hgt * z > H + 200) return;
    g.save(); g.translate(sx, sy); g.rotate(Cm.r + s.rot + P.rot * (0.5 + 0.5 * k)); g.scale(z, z);
    g.globalAlpha = clamp(age / 0.12);
    const m = 26;
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(-P.w / 2 - m + 16, -hgt / 2 - m + 20, P.w + 2 * m, hgt + 2 * m);
    g.fillStyle = '#f7f5f0'; g.fillRect(-P.w / 2 - m, -hgt / 2 - m, P.w + 2 * m, hgt + 2 * m);
    g.drawImage(P.img, -P.w / 2, -hgt / 2, P.w, hgt);
    const gr = opt.block(s, b);
    if (gr > 0 && b < CUT) blockDraw(g, P.w + 2 * m, hgt + 2 * m, gr);
    else if (gr > 0) { const tc = B.time(b) - B.time(CUT); if (tc < 1.6) { g.translate(0, 0.5 * 9000 * tc * tc); g.rotate(-tc); blockDraw(g, P.w + 2 * m, hgt + 2 * m, 1, clamp(1 - tc / 1.6)); } }
    g.restore();
  }
  // the title blocks' growth: they appear on every sheet at THE LAST FORM ..., then spread to cover the drawings by beat 84
  const blockGrow = (s, b) => {
    if (b < s.block0 || s.appear > b) return 0;
    if (b >= CUT) return s.appear < CUT ? 1 : 0;          // sheets that arrive after the cut never had one
    const pop = ease.outBack(clamp((b - s.block0) / 0.5));
    return 0.0001 + Math.min(1, pop * 0.02 + ease.inOutCubic(clamp((b - (WALL + 2)) / (84 - WALL - 2))));
  };

  // ---------------------------------------------------------------- the words
  const credits = cards.credits;
  function words(g, t, b) {
    let card = null; for (const c of cards.cards) if (b >= c.beat && b < c.end) card = c;
    // the band behind the words: the table's own dark, so the type always reads
    const gr = g.createLinearGradient(0, 0, 0, 720);
    gr.addColorStop(0, 'rgba(14,13,12,0.92)'); gr.addColorStop(0.72, 'rgba(14,13,12,0.80)'); gr.addColorStop(1, 'rgba(14,13,12,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, 720);
    if (!card) return null;
    const age = t - B.time(card.beat);
    const big = !!card.big, maxW = 900, maxSize = big ? 190 : 112;
    g.save(); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    // wrap into at most 2 lines at the largest size that fits
    const fit = (txt) => {
      for (let sz = maxSize; sz >= 54; sz -= 4) {
        g.font = `${sz}px "Anton"`;
        if (g.measureText(txt).width <= maxW) return { lines: [txt], sz };
        const wds = txt.split(' '); let best = null;
        for (let k = 1; k < wds.length; k++) {
          const l1 = wds.slice(0, k).join(' '), l2 = wds.slice(k).join(' ');
          const m = Math.max(g.measureText(l1).width, g.measureText(l2).width);
          if (m <= maxW && (!best || m < best.m)) best = { m, lines: [l1, l2] };
        }
        if (best) return { lines: best.lines, sz };
      }
      return { lines: [txt], sz: 54 };
    };
    const F = fit(card.text);
    const blur = Math.max(0, 7 * (1 - age / 0.16));       // each card comes out of the copier too: soft, then sharp
    if (blur > 0.3) g.filter = `blur(${blur.toFixed(1)}px)`;
    g.font = `${F.sz}px "Anton"`; g.fillStyle = C.cream;
    const lh = F.sz * 1.02, n = F.lines.length, y0 = 300 + (big ? 30 : 0) + (2 - n) * lh * 0.5 + lh * 0.82;
    F.lines.forEach((l, k) => g.fillText(l, W / 2, y0 + k * lh));
    g.filter = 'none';
    const cr = card.src === 'c4' && !((card.beat >= 0 && card.beat < 22) || card.beat >= WALL) ? null : credits[card.src];
    if (cr) {
      g.font = '25px "Plex Mono"'; g.fillStyle = 'rgba(244,230,208,0.78)';
      g.fillText(cr, W / 2, y0 + (n - 1) * lh + 62);
    }
    g.restore();
    return card.text;
  }

  // ---------------------------------------------------------------- the mark: the last sheet, printed by the copier
  const markCv = mk(W, H), mg = markCv.getContext('2d');
  function lastSheet(g, b) {
    const a0 = MARKB - 4.2;
    if (b < a0) return;
    const age = b - a0, k = ease.outCubic(clamp(age / 0.7));
    const w = 860, h = 1080, y = VY + (1 - k) * 1300;
    g.save(); g.translate(W / 2, y);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(-w / 2 + 16, -h / 2 + 20, w, h);
    g.fillStyle = PAPER; g.fillRect(-w / 2, -h / 2, w, h);
    const p = clamp((age - 0.8) / 1.6);                 // the light bar prints the mark
    const yb = -h / 2 + h * p;
    g.save(); g.beginPath(); g.rect(-w / 2, -h / 2, w, h * p); g.clip();
    markStroke(g, 0, -40, 330, 2.2, INK);              // the construction: its outline
    const fill = clamp((age - 1.7) / 0.6);
    if (fill > 0) drawMark(g, 0, -40, 330, { alpha: fill });
    g.restore();
    if (p > 0 && p < 1) lightBar(g, w, yb, 1);
    g.restore();
  }

  // ---------------------------------------------------------------- the frame
  let lastCut = -1;
  async function frame(t) {
    const b = B.beat(t);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'; ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = TABLE; ctx.fillRect(0, 0, W, H);
    if (t >= MARK + 0.25) { closer_(ctx, t - MARK); return { b, shot: 'mark' }; }
    const out = await draw(t, Math.min(b, MARKB - 1e-4));
    if (t >= MARK) {                                    // the closer comes up out of the last sheet
      const cg = closerCv.getContext('2d'); cg.setTransform(1, 0, 0, 1, 0, 0); cg.clearRect(0, 0, W, H); closer_(cg, t - MARK);
      ctx.save(); ctx.globalAlpha = clamp((t - MARK) / 0.25); ctx.drawImage(closerCv, 0, 0); ctx.restore();
      out.shot = 'mark';
    }
    return out;
  }
  const closerCv = mk(W, H);
  const closer_ = dry ? () => {} : closer;             // (the dry run has no brand images)
  async function draw(t, b) {
    let shot;
    if (b < 16) {                                       // one sheet, copied: each card's copy is sharper than the last
      shot = 'copy';
      const w = 1000, h = w * SH.engine.ar, z = 0.96 + 0.006 * b;
      const scans = [0, 4, 8, 11, 14];                 // a pass on each card; the copy it makes is the next generation
      let gen = 0, pass = null;
      for (let n = 0; n < scans.length; n++) {
        const s0 = scans[n], dur = Math.min(2.2, (scans[n + 1] ?? 16) - s0 - 0.4);
        if (b >= s0 + dur) gen = n + 1; else if (b >= s0) { pass = { n, u: (b - s0) / dur }; break; }
      }
      gen = Math.min(gen, GENS.length - 1);
      const cy = 560 + h * z / 2 + 10;
      ctx.save(); ctx.translate(W / 2, cy); ctx.scale(z, z);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-w / 2 + 14, -h / 2 + 18, w, h);
      ctx.drawImage(HERO[gen], -w / 2, -h / 2, w, h);
      if (pass) {
        const nxt = HERO[Math.min(pass.n + 1, GENS.length - 1)], yb = -h / 2 + h * ease.inOutCubic(pass.u);
        ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, yb + h / 2); ctx.clip(); ctx.drawImage(nxt, -w / 2, -h / 2, w, h); ctx.restore();
        lightBar(ctx, w, yb, 1);
      }
      ctx.restore();
    } else {
      shot = b < 22 ? 'fall' : b < 50 ? 'spread' : b < 64 ? 'list' : b < WALL ? 'table' : b < CUT ? 'wall' : 'world';
      const Cm = camAt(b);
      const opt = { block: blockGrow, freezeScan: (b >= WALL && b < CUT) ? Math.min(b, WALL + 6) : null };
      for (const s of sheets) drawSheet(ctx, Cm, s, b, opt);
      for (const P of prints) drawPrint(ctx, Cm, P, b, opt);
      if (b >= CUT && B.time(b) - B.time(CUT) < 0.2) {   // the one cut, across the whole frame
        const u = (B.time(b) - B.time(CUT)) / 0.2;
        ctx.save(); ctx.translate(W / 2, VY - 120); ctx.rotate(-0.42);
        ctx.fillStyle = `rgba(255,252,240,${1 - u})`; ctx.fillRect(-1400, -4 - 10 * u, 2800, 8 + 20 * u);
        ctx.restore();
      }
      if (b >= WALL && b < CUT) {                       // the room dims as the blocks close
        ctx.fillStyle = `rgba(10,9,8,${0.28 * smooth(WALL, STALL, b)})`; ctx.fillRect(0, 0, W, H);
      }
      lastSheet(ctx, b);
    }
    const said = words(ctx, t, b);
    return { b, shot, said };
  }
  return { frame, B, MARK, sheets, prints, camAt };
}
