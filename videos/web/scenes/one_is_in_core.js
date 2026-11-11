// ONE IS IN: the shared engine for one_is_in.js / _a.js / _b.js.
// A timeline of shots read from assets/one_is_in/tl_<variant>.json (the script of record, built by
// review/ONE_IS_IN_c2/build_timeline.py). Pictures: three public-domain photographs of Debs (Wikimedia Commons),
// printed in newsprint tones, a raking light that moves over them and never over a face's features.
// Type: HIS words in IM Fell (a period book face, set in ink on plain newsprint); OUR facts in IBM Plex Mono caps
// (the reporter's typed copy). Nothing is a constructed newspaper: no masthead, no paper name, no clipping.
import { W, H, clamp, lerp, ease, rng, Finish, outCanvas, loadImage } from '../lib/kit.js';
import { drawMark, markBox } from '../lib/closer.js';

const INK = '#15110d', CREAM = '#efe6d2', RED = '#b4211c', REDL = '#d0342b';
const FONTS = { fell: '"FellEn"', felli: 'italic "FellEn"', mono: '700 "PlexB"' };

async function loadFonts2() {
  const b = '../node_modules/@fontsource';
  const faces = [['FellEn', 'normal', `${b}/im-fell-english/files/im-fell-english-latin-400-normal.woff2`],
    ['FellEn', 'italic', `${b}/im-fell-english/files/im-fell-english-latin-400-italic.woff2`],
    ['PlexB', 'normal', `${b}/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2`]];
  await Promise.all(faces.map(async ([n, st, u]) => { const f = new FontFace(n, `url(${u})`, { style: st }); document.fonts.add(await f.load()); }));
}

// ---------------------------------------------------------------- paper stocks
function makePaper(kind, seed) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), r = rng(seed);
  const base = kind === 'news' ? [214, 205, 184] : [17, 15, 13];
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, W, H);
  // low-frequency mottle
  const m = document.createElement('canvas'); m.width = 36; m.height = 64;
  const mg = m.getContext('2d'), md = mg.createImageData(36, 64);
  for (let i = 0; i < md.data.length; i += 4) { const v = 128 + (r() - 0.5) * (kind === 'news' ? 70 : 40); md.data[i] = md.data[i + 1] = md.data[i + 2] = v; md.data[i + 3] = 255; }
  mg.putImageData(md, 0, 0);
  g.save(); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = kind === 'news' ? 0.55 : 0.5; g.imageSmoothingEnabled = true; g.drawImage(m, 0, 0, W, H); g.restore();
  // fibres
  g.save();
  for (let i = 0; i < (kind === 'news' ? 2600 : 1400); i++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI, l = 6 + r() * 26;
    g.strokeStyle = r() < 0.5 ? `rgba(60,48,30,${0.035 + r() * 0.05})` : `rgba(255,250,235,${0.04 + r() * 0.07})`;
    g.lineWidth = 0.6 + r() * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.6); g.stroke();
  }
  g.restore();
  // fine speckle
  const id = g.getImageData(0, 0, W, H), d = id.data;
  const amp = kind === 'news' ? 11 : 7;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  g.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------- photographs: graded once
function grade(img, { contrast = 1.3, bright = 1.0, sepia = 0.35 } = {}) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.filter = `grayscale(1) contrast(${contrast}) brightness(${bright}) sepia(${sepia})`;
  g.drawImage(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- text
function tokens(txt) {            // "a *b c* d" -> [{w:'a',red:false},{w:'b',red:true},...]
  const out = []; let red = false;
  for (const raw of txt.split(' ')) {
    let w = raw, st = false, en = false;
    if (w.startsWith('*')) { st = true; w = w.slice(1); }
    if (w.endsWith('*')) { en = true; w = w.slice(0, -1); }
    if (st) red = true;
    out.push({ w, red });
    if (en) red = false;
  }
  return out;
}
function layout(ctx, o) {
  ctx.font = `${o.size}px ${FONTS[o.font]}`.replace(/^(\d+px)/, '$1');
  const fontStr = o.font === 'mono' ? `700 ${o.size}px "PlexB"` : o.font === 'felli' ? `italic ${o.size}px "FellEn"` : `${o.size}px "FellEn"`;
  ctx.font = fontStr;
  const tr = o.tr || 0;
  const sp = ctx.measureText(' ').width + tr;
  const toks = tokens(o.txt).map(t => ({ ...t, ww: ctx.measureText(t.w).width + tr * t.w.length }));
  const maxw = o.maxw || 900, lines = [[]];
  let cur = 0;
  for (const t of toks) {
    if (t.w === '/') { lines.push([]); cur = 0; continue; }          // explicit break
    if (lines[lines.length - 1].length && cur + sp + t.ww > maxw) { lines.push([]); cur = 0; }
    lines[lines.length - 1].push(t); cur += (cur ? sp : 0) + t.ww;
  }
  const lh = o.lh || o.size * 1.12;
  let idx = 0;
  for (const ln of lines) { ln.width = ln.reduce((a, t) => a + t.ww, 0) + sp * (ln.length - 1); for (const t of ln) t.i = idx++; }
  return { lines, lh, sp, n: idx, fontStr, H: lines.length * lh };
}

// draw one text item at local time u (s). o: {txt,t,font,size,x,y,align,color,tr,maxw,lh,rd,reveal,fade,out}
function drawText(ctx, o, u, ink) {
  const tt = u - (o.t || 0);
  if (tt < 0) return;
  const L = o._L || (o._L = layout(ctx, o));
  const rd = o.rd == null ? 0.6 : o.rd, reveal = o.reveal || 'words';
  let outA = 1;
  if (o.out != null) outA = 1 - clamp((u - o.out) / 0.25);
  if (outA <= 0) return;
  const col = o.color === 'red' ? (ink ? RED : REDL) : o.color === 'cream' ? CREAM : o.color === 'ink' ? INK : (o.color || (ink ? INK : CREAM));
  ctx.save();
  ctx.font = L.fontStr; ctx.textBaseline = 'alphabetic';
  const y0 = o.y - L.H / 2 + L.lh * 0.78;
  const tr = o.tr || 0;
  if ('letterSpacing' in ctx) ctx.letterSpacing = tr ? tr + 'px' : '0px';
  L.lines.forEach((ln, li) => {
    let x = o.align === 'left' ? o.x : o.align === 'right' ? o.x - ln.width : o.x - ln.width / 2;
    const y = y0 + li * L.lh;
    for (const t of ln) {
      let a = 1, dy = 0;
      if (reveal === 'words') {
        const ti = (t.i / Math.max(1, L.n)) * rd;
        a = clamp((tt - ti) / 0.2); dy = (1 - a) * 8;
      } else if (reveal === 'fade') a = clamp(tt / (rd || 0.3));
      if (a > 0) {
        const c = t.red ? (ink ? RED : REDL) : col;
        ctx.fillStyle = c;
        if (ink) {                                         // ink spread: a soft halo, then the sharp letter
          ctx.globalAlpha = a * outA * 0.45; ctx.shadowColor = c; ctx.shadowBlur = o.size > 90 ? 5 : 3; ctx.fillText(t.w, x, y + dy);
          ctx.shadowBlur = 0;
        } else if (o.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3; }
        ctx.globalAlpha = a * outA; ctx.fillText(t.w, x, y + dy);
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      }
      x += t.ww + L.sp;
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- the light
function raking(ctx, p, { strength = 0.5, width = 0.55, ang = 0.35, mode = 'soft-light' } = {}) {
  const g = ctx.createLinearGradient(0, 0, W * Math.cos(ang) + H * Math.sin(ang) * 0.5, H * 0.6 + W * Math.sin(ang));
  const c = lerp(-0.25, 1.25, p);
  g.addColorStop(clamp(c - width), 'rgba(255,244,214,0)');
  g.addColorStop(clamp(c), `rgba(255,244,214,${strength})`);
  g.addColorStop(clamp(c + width), 'rgba(255,244,214,0)');
  ctx.save(); ctx.globalCompositeOperation = mode; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
}

// ---------------------------------------------------------------- run
export async function run(variant) {
  const ctx = outCanvas();
  await loadFonts2();
  const TL = await (await fetch(`../assets/one_is_in/tl_${variant}.json`)).json();
  const IM = {};
  const raw = { canton: 'canton_1918.jpg', atlanta: 'atlanta_portrait.jpg', release: 'release_1921.jpg' };
  await Promise.all(Object.entries(raw).map(async ([k, f]) => { IM[k] = grade(await loadImage(`../assets/one_is_in/${f}`), TL.grade?.[k] || {}); }));
  const PAPER = { news: makePaper('news', 11), black: makePaper('black', 5) };
  const finish = new Finish(9);
  let t0 = 0;
  const shots = TL.shots.map(s => { const o = { ...s, t0 }; t0 += s.dur; return o; });
  const total = t0;
  window.__timeline = { shots: shots.map(s => ({ id: s.id, t0: s.t0, dur: s.dur })), total };

  // ---- photo backdrop
  function photo(bg, u, dur) {
    const img = IM[bg.img], p = clamp(u / dur);
    const z = lerp(bg.z0 ?? 1, bg.z1 ?? 1.08, p);
    const s0 = bg.top != null ? W / img.width : Math.max(W / img.width, H / img.height), s = s0 * z, iw = img.width * s, ih = img.height * s;
    const cx = bg.cx ?? 0.5, cy = bg.cy ?? 0.5;
    let x = W * cx - (bg.fx ?? 0.5) * iw, y = bg.top != null ? bg.top : H * cy - (bg.fy ?? 0.5) * ih;
    x = clamp(x, W - iw, 0); if (bg.top == null) y = clamp(y, H - ih, 0);
    ctx.drawImage(img, x, y, iw, ih);
    return { x, y, iw, ih };
  }
  function printCard(bg, u, dur) {     // a photograph as a print on dark stock: cream matte, soft shadow, a degree of tilt
    const img = IM[bg.img], P = bg.print, p = clamp(u / dur);
    const w = P.w, h = w * img.height / img.width, m = P.m ?? 16;
    ctx.save();
    ctx.translate(P.x, P.y); ctx.rotate((P.rot || 0) * Math.PI / 180 + (P.drift || 0) * (p - 0.5) * Math.PI / 180);
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#e6dcc4'; ctx.fillRect(-w / 2 - m, -h / 2 - m, w + 2 * m, h + 2 * m);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    const z = lerp(P.z0 ?? 1, P.z1 ?? 1.04, p);
    ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
    ctx.drawImage(img, -w / 2 * z + (P.px || 0) * p, -h / 2 * z, w * z, h * z);
    if (bg.light) raking(ctx, lerp(bg.light[0], bg.light[1], p), { strength: bg.lightS ?? 0.5, mode: 'soft-light' });
    ctx.restore();
  }

  // ---- custom set pieces
  const E = {};
  E.count = (s, u) => {                           // a vote count that rolls up and locks
    const e = s.extra, p = clamp((u - (e.t || 0)) / (e.rd || 1.4)), k = ease.outCubic(p);
    const v = Math.round(e.to * k);
    const str = v.toLocaleString('en-US');
    ctx.save(); ctx.font = `${e.size}px "FellEn"`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = e.color === 'red' ? (e.ink ? RED : REDL) : (e.color || CREAM);
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = e.ink ? 4 : 24; ctx.shadowOffsetY = e.ink ? 0 : 4;
    ctx.fillText(str, e.x ?? W / 2 - 30, e.y); ctx.restore();
  };
  E.twins = (s, u) => {                           // TWINS, printed twice: the second is the first's reflection
    const e = s.extra, a = clamp((u - e.t) / 0.35), b = clamp((u - e.t - 0.55) / 0.5);
    ctx.save(); ctx.font = `${e.size}px "FellEn"`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const y = e.y, w = ctx.measureText(e.word).width;
    const red = e.onDark ? REDL : RED;
    ctx.fillStyle = red;
    if (!e.onDark) { ctx.shadowColor = RED; ctx.shadowBlur = 5; ctx.globalAlpha = a * 0.5; ctx.fillText(e.word, W / 2, y); ctx.shadowBlur = 0; }
    ctx.globalAlpha = a; ctx.fillText(e.word, W / 2, y);
    // axis rule
    ctx.globalAlpha = b; ctx.fillStyle = e.onDark ? CREAM : INK; ctx.fillRect(W / 2 - w / 2 - 20, y + 26, w + 40, 3);
    ctx.translate(W / 2, y + 26 + 3 + 26); ctx.scale(1, -1);
    ctx.globalAlpha = b * 0.9; ctx.fillStyle = red; ctx.fillText(e.word, 0, 0);
    ctx.restore();
  };
  E.door = (s, u) => {                            // one is in; the other, trying to break in
    const e = s.extra, bx = 150, bw = 780, by = 380, bh = 420;
    const a = clamp((u - e.t) / 0.5);
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.globalAlpha = a;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.lineWidth = 2; ctx.strokeRect(bx + 14, by + 14, bw - 28, bh - 28);
    ctx.restore();
    // "one is in": inside the box, still
    const f = (txt, t, y, size, col, clip) => {
      if (u < t) return;
      ctx.save();
      if (clip) { ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(bx - 3, by - 3, bw + 6, bh + 6); ctx.clip('evenodd'); }
      drawText(ctx, { txt, t, font: 'fell', size, x: W / 2, y, align: 'center', color: col, maxw: bw - 80, rd: 0.7 }, u, true);
      ctx.restore();
    };
    f('one is in', e.t1, by + bh / 2, 150, 'ink', false);
    // the other presses at the box's edge from outside: its letters stop at the border, jitter, never come in
    if (u >= e.t2) {
      const k = clamp((u - e.t2) / 1.0), jit = Math.sin((u - e.t2) * 38) * 4 * (1 - Math.abs(k - 0.7));
      ctx.save();
      ctx.translate(0, 0);
      const ty = by + bh + 118 - ease.outCubic(k) * 36 + jit;
      drawText(ctx, { txt: 'the other trying to *break in,*', t: e.t2, font: 'fell', size: 96, x: W / 2, y: ty, align: 'center', maxw: 900, rd: 0.8 }, u, true);
      ctx.restore();
    }
    drawText(ctx, { txt: 'and that is substantially the only difference between them.', t: e.t3, font: 'fell', size: 78, x: W / 2, y: 1130, align: 'center', maxw: 860, rd: 1.6, lh: 88 }, u, true);
  };
  const ROW_Y = [330, 600, 870, 1140];             // the column's rules: they become the mark's four stripes
  const RULE_X0 = 90, RULE_X1 = 990;
  function rules(prog, u, tIn, col = INK) {         // draws the 4 ruled lines of the column
    ctx.save(); ctx.fillStyle = col;
    ROW_Y.forEach((y, i) => { const k = clamp((u - tIn - i * 0.12) / 0.5); if (k > 0) ctx.fillRect(RULE_X0, y, (RULE_X1 - RULE_X0) * ease.outCubic(k), 6); });
    ctx.restore();
  }
  const BOARD_Y = [360, 750, 1140, 1530];          // the board's own rules: taller rows, the group centred in the frame
  E.board = (s, u) => {                            // our own results board: plainly ours, from the Wikipedia table
    const e = s.extra, rows = e.rows, sw = 800;
    ctx.save(); ctx.fillStyle = INK;
    BOARD_Y.forEach((y, i) => { const k = clamp((u - i * 0.12) / 0.5); if (k > 0) ctx.fillRect(RULE_X0, y, (RULE_X1 - RULE_X0) * ease.outCubic(k), 6); });
    ctx.restore();
    ctx.save(); ctx.textBaseline = 'alphabetic';
    drawText(ctx, { txt: e.head, t: 0.1, font: 'mono', size: 54, tr: 3, x: 90, y: BOARD_Y[0] - 46, align: 'left', maxw: 900, reveal: 'fade', rd: 0.3 }, u, true);
    rows.forEach((r, i) => {
      const y0 = BOARD_Y[i] + 6, t = e.t + i * e.gap, isD = r.debs;
      if (u < t) return;
      const a = clamp((u - t) / 0.25);
      drawText(ctx, { txt: r.name, t, font: 'mono', size: 51, tr: 2, x: 90, y: y0 + 72, align: 'left', maxw: 900, lh: 58, reveal: 'fade', rd: 0.2, color: isD ? 'red' : 'ink' }, u, true);
      // count
      const k = isD ? ease.outCubic(clamp((u - t - 0.2) / (e.roll || 1.3))) : 1;
      const v = Math.round(r.n * k);
      ctx.save(); ctx.globalAlpha = a; ctx.font = `${isD ? 215 : 185}px "FellEn"`; ctx.fillStyle = isD ? RED : INK;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 4; ctx.fillText(v.toLocaleString('en-US'), 90, y0 + 285); ctx.restore();
      // share bar + percent
      const bw = sw * (r.pct / 100) * k;
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = isD ? RED : INK; ctx.fillRect(90, y0 + 326, Math.max(4, bw), 14); ctx.restore();
      drawText(ctx, { txt: r.pct + ' PERCENT', t, font: 'mono', size: 45, tr: 2, x: 990, y: y0 + 358, align: 'right', maxw: 600, reveal: 'fade', rd: 0.2, color: isD ? 'red' : 'ink' }, u, true);
    });
    ctx.restore();
  };
  E.dates = (s, u) => {
    const e = s.extra;
    rules(1, u, 0.0);
    e.rows.forEach((r, i) => {
      const y0 = ROW_Y[i] + 6;
      drawText(ctx, { txt: r.date, t: r.t, font: 'fell', size: 150, x: 90, y: y0 + 120, align: 'left', maxw: 900, reveal: 'words', rd: 0.5, color: r.red ? 'red' : 'ink' }, u, true);
      drawText(ctx, { txt: r.note, t: r.t + 0.5, font: 'mono', size: 57, tr: 3, x: 90, y: y0 + 228, align: 'left', maxw: 900, reveal: 'fade', rd: 0.4, color: r.red ? 'red' : 'ink' }, u, true);
    });
  };
  E.mark = (s, u) => {                              // the column's rules become the mark's four stripes
    const e = s.extra, S = 330, cx = W / 2, cy = 800, g = markBox(cx, cy, S);
    const m = clamp((u - e.m0) / e.md);             // morph 0..1
    const k = ease.inOutCubic(m);
    // text fades as the rules move
    const fa = 1 - clamp((u - e.m0 + 0.3) / 0.5);
    if (fa > 0) {
      ctx.save(); ctx.globalAlpha = fa;
      e.rows.forEach((r, i) => {
        const y0 = ROW_Y[i] + 6;
        drawText(ctx, { txt: r.date, t: -9, font: 'fell', size: 150, x: 90, y: y0 + 120, align: 'left', maxw: 900, reveal: 'none', color: r.red ? 'red' : 'ink' }, u, true);
        drawText(ctx, { txt: r.note, t: -9, font: 'mono', size: 57, tr: 3, x: 90, y: y0 + 228, align: 'left', maxw: 900, reveal: 'none', color: r.red ? 'red' : 'ink' }, u, true);
      });
      ctx.restore();
    }
    // the stripes: from rule rect to stripe rect, ink to the mark's red
    const mix = (a, b, x) => Math.round(a + (b - a) * x);
    const col = `rgb(${mix(21, 191, k)},${mix(17, 31, k)},${mix(13, 31, k)})`;
    ctx.fillStyle = col;
    g.stripes.forEach((sr, i) => {
      const x0 = lerp(RULE_X0, sr.x0, k), x1 = lerp(RULE_X1, sr.x1, k), y0 = lerp(ROW_Y[i], sr.y0, k), y1 = lerp(ROW_Y[i] + 6, sr.y1, k);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    });
    // the badge arrives after the stripes settle
    const ba = ease.outCubic(clamp((u - e.m0 - e.md + 0.15) / 0.7));
    if (ba > 0) drawMark(ctx, cx, cy, S, { color: '#bf1f1f', alpha: ba, badge: 1, stripes: [0, 0, 0, 0] });
    // ACP.US at the lock
    const la = clamp((u - e.lock) / 0.35);
    if (la > 0) {
      ctx.save(); ctx.globalAlpha = la; ctx.font = '700 62px "PlexB"'; ctx.fillStyle = INK; ctx.textAlign = 'center';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
      ctx.fillText('ACP.US', W / 2 + 5, 1090); ctx.restore();
    }
  };

  // ---------------------------------------------------------------- frame
  window.renderFrame = async (t) => {
    const frame = Math.round(t * 30);
    let s = shots[shots.length - 1];
    for (const x of shots) if (t >= x.t0 && t < x.t0 + x.dur) { s = x; break; }
    const u = t - s.t0, bg = s.bg, ink = bg.type === 'paper' && bg.stock === 'news';
    if (bg.type === 'paper') {
      ctx.drawImage(PAPER[bg.stock], 0, 0);
      if (bg.light) raking(ctx, lerp(bg.light[0], bg.light[1], clamp(u / s.dur)), { strength: bg.lightS ?? 0.35, mode: 'soft-light' });
    } else if (bg.type === 'photo') {
      ctx.fillStyle = '#0b0a09'; ctx.fillRect(0, 0, W, H);
      photo(bg, u, s.dur);
      const dim = lerp(bg.dim0 ?? 0.2, bg.dim1 ?? bg.dim0 ?? 0.2, clamp(u / s.dur));
      ctx.fillStyle = `rgba(8,6,4,${dim})`; ctx.fillRect(0, 0, W, H);
      if (bg.lowGrad) { const g = ctx.createLinearGradient(0, H * 0.45, 0, H * 0.82); g.addColorStop(0, 'rgba(6,5,4,0)'); g.addColorStop(1, `rgba(6,5,4,${bg.lowGrad})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      if (bg.light) raking(ctx, lerp(bg.light[0], bg.light[1], clamp(u / s.dur)), { strength: bg.lightS ?? 0.55, mode: 'soft-light' });
      if (bg.floor) {                                   // a dark field below the picture: the type's own ground
        const [f0, f1] = bg.floor, g = ctx.createLinearGradient(0, f0, 0, f1);
        g.addColorStop(0, 'rgba(9,7,5,0)'); g.addColorStop(1, 'rgba(9,7,5,1)');
        ctx.fillStyle = g; ctx.fillRect(0, f0, W, f1 - f0); ctx.fillStyle = 'rgb(9,7,5)'; ctx.fillRect(0, f1, W, H - f1);
      }
    } else if (bg.type === 'print') {
      ctx.drawImage(PAPER.black, 0, 0);
      printCard(bg, u, s.dur);
      const dim = lerp(bg.dim0 ?? 0, bg.dim1 ?? 0, clamp(u / s.dur));
      if (dim > 0) { ctx.fillStyle = `rgba(8,6,4,${dim})`; ctx.fillRect(0, 0, W, H); }
    }
    // a dark field that cuts in under a line (no dissolve): [t, alpha]
    if (s.field && u >= s.field[0]) { ctx.fillStyle = `rgba(8,6,4,${s.field[1]})`; ctx.fillRect(0, 0, W, H); }
    if (s.extra && E[s.extra.kind]) E[s.extra.kind](s, u);
    for (const tx of s.texts || []) drawText(ctx, { ...tx }, u, ink && !tx.onDark);
    // shot-level fades: fade in from black, fade out to black
    if (s.fadeIn && u < s.fadeIn) { ctx.fillStyle = `rgba(7,5,4,${1 - u / s.fadeIn})`; ctx.fillRect(0, 0, W, H); }
    if (s.fadeOut && u > s.dur - s.fadeOut) { ctx.fillStyle = `rgba(7,5,4,${(u - (s.dur - s.fadeOut)) / s.fadeOut})`; ctx.fillRect(0, 0, W, H); }
    // a held-breath darkening where the room goes quiet
    if (s.hush) { const a = clamp((u - s.hush[0]) / 0.5) * (1 - clamp((u - s.hush[1]) / 0.4)); if (a > 0) { ctx.fillStyle = `rgba(6,5,4,${0.5 * a})`; ctx.fillRect(0, 0, W, H); } }
    finish.apply(ctx, frame, { grain: ink ? 0.07 : 0.1, vignette: ink ? 0.28 : 0.6 });
  };
  window.sceneReady = true;
}
