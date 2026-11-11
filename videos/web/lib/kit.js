// Shared kit for the ACP agitprop scenes: palette, fonts, beat clock, easing,
// kinetic type, film finish, the ☭≡/acc sigil and the ACP sign-off card.
import { drawMark as _vMark, drawLockup as _vLock, RED as _VRED } from './closer.js';   // CLOSER c1: the mark as vector (set globalThis.__acpRaster = true for the old bitmaps)
export const W = 1080, H = 1920;

export const C = {
  red: '#BD1818',       // ACP logo red
  red2: '#C91F37',      // poster red
  cream: '#F4E6D0',
  black: '#0B0B0B',
  ink: '#150606',
  steel: '#3A3434',
};

const FONT_DIR = '../node_modules/@fontsource';
export async function loadFonts() {
  const faces = [
    ['Anton', `${FONT_DIR}/anton/files/anton-latin-400-normal.woff2`],
    ['Archivo Black', `${FONT_DIR}/archivo-black/files/archivo-black-latin-400-normal.woff2`],
    ['Michroma', `${FONT_DIR}/michroma/files/michroma-latin-400-normal.woff2`],
    ['Plex Mono', `${FONT_DIR}/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2`],
  ];
  await Promise.all(faces.map(async ([name, url]) => {
    const f = new FontFace(name, `url(${url})`);
    document.fonts.add(await f.load());
  }));
  await loadBrand();
}

export async function loadBeats(scene) {
  const d = await (await fetch(`../../out/.${scene}.hits.json`)).json();
  return new Beats(d);
}

export class Beats {
  constructor(d) {
    Object.assign(this, d);
    this.spb = 60 / d.bpm;
    this.barLen = this.spb * 4;
    // MUSIC c13: a song with a tempo map (engine/daw/clock.py) writes beat_times[] (the time of every beat). Then beat(t),
    // time(b), bar(t), barPhase(t) and barStart(b) follow the map, so an accelerando is followed; without it nothing changes.
    // spb stays the nominal tempo: code that multiplies beats by spb keeps a constant grid.
    this.bt = Array.isArray(d.beat_times) && d.beat_times.length > 1 ? d.beat_times : null;
  }
  beat(t) {
    const a = this.bt;
    if (!a) return t / this.spb;
    if (t <= a[0]) return (t - a[0]) / (a[1] - a[0]);
    const n = a.length - 1;
    if (t >= a[n]) return n + (t - a[n]) / (a[n] - a[n - 1]);
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m; else hi = m; }
    return lo + (t - a[lo]) / (a[lo + 1] - a[lo]);
  }
  time(b) {
    const a = this.bt;
    if (!a) return b * this.spb;
    const n = a.length - 1;
    if (b <= 0) return a[0] + b * (a[1] - a[0]);
    if (b >= n) return a[n] + (b - n) * (a[n] - a[n - 1]);
    const i = Math.floor(b);
    return a[i] + (b - i) * (a[i + 1] - a[i]);
  }
  bar(t) { return this.bt ? Math.floor(this.beat(t) / 4) : Math.floor(t / this.barLen); }
  barPhase(t) { return this.bt ? ((this.beat(t) / 4) % 1 + 1) % 1 : (t / this.barLen) % 1; }
  barStart(b) { return this.bt ? this.time(b * 4) : b * this.barLen; }
  last(name, t) {
    const h = this.hits[name];
    if (!h) return -1e9;
    let lo = 0, hi = h.length - 1, r = -1e9;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m] <= t + 1e-4) { r = h[m]; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  count(name, t) { const h = this.hits[name] || []; let n = 0; for (const x of h) { if (x <= t + 1e-4) n++; else break; } return n; }
  env(name, t, rate = 8) { const l = this.last(name, t); return l < -1e8 ? 0 : Math.exp(-(t - l) * rate); }
}

// ---------------------------------------------------------------- math
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, x) => a + (b - a) * x;
export const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const ease = {
  outCubic: x => 1 - Math.pow(1 - clamp(x), 3),
  inOutCubic: x => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outExpo: x => (x = clamp(x), x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  outBack: x => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  inCubic: x => Math.pow(clamp(x), 3),
  inExpo: x => (x = clamp(x), x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
};
export function rng(seed) {           // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// ---------------------------------------------------------------- brand palette + hashing (shared by the fx libs)
// PAL: brand colours as 0..1 triples (for GL uniforms and point colours). hexf('#C91F37', k) scales.
export const hexf = (h, k = 1) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255 * k);
export const PAL = {
  red: hexf('#C91F37'), red2: hexf('#BD1818'), cream: hexf('#F4E6D0'), black: hexf('#0B0B0B'),
  ink: hexf('#150606'), oxblood: hexf('#3A0508'), ember: hexf('#F58C5C'), hot: hexf('#FFE9CF'), paper: hexf('#EFE0C6'),
};
export const rgb8 = c => c.map(v => Math.round(clamp(v) * 255));        // 0..1 -> 0..255 (point-set colours)
export function hash01(i) {           // integer -> [0,1), stateless (per-point variation without an rng)
  let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
// Weighted palette pick per point: pick(i, seed, [[0.9, PAL.cream], [0.1, PAL.red]]) -> 0..255 rgb.
// Use as recolor(ps, (x, y, z, i) => pick(i, 3, table)).
export function pick(i, seed, table) {
  const h = hash01(i * 3 + seed * 7919), tot = table.reduce((a, [w]) => a + w, 0); let acc = 0;
  for (const [w, c] of table) { acc += w / tot; if (h < acc) return rgb8(c); }
  return rgb8(table[table.length - 1][1]);
}
export const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// ---------------------------------------------------------------- type
export function setFont(ctx, family, size, weight = '') { ctx.font = `${weight} ${size}px "${family}"`.trim(); }

// Type layer (opt-in, off by default): while TYPE.layer is a 2D context, every line() of size >= TYPE.min (and
// every sigil() lockup at least that tall) is drawn there instead, with the caller's transform, alpha and composite op. A post chain then composites the
// words after its destructive stages (lib/fx/post.js: apply({ world, type }, ...)), so slogans stay crisp.
export const TYPE = { layer: null, min: 120, safe: false };
// Phone-safe type band (TYPE studio, cycle 1): Reels / TikTok draw their caption, handle and buttons over the bottom 35 %
// and the top 14 % of a 1080x1920 frame, and a button rail down the right. Legible type belongs in y 270-1250, x 60-960.
// cue()/headline() keep their old defaults; pass { safe: true } (or set TYPE.safe = true once per piece) to clamp
// into the band, drop the drop shadow and centre on the band. lib/fx/type_world.js (setBlock, recipes) is the full system.
export const SAFE_BAND = { x1: 60, x2: 960, y1: 270, y2: 1250, cx: 510 };
export function typeLayer(ctx, min = 120) { TYPE.layer = ctx; TYPE.min = min; }

// Draw one line with optional tracking (letter-spacing), fitted to maxW.
export function line(ctx, str, x, y, o = {}) {
  const { family = 'Anton', size = 160, color = C.cream, align = 'center', tracking = 0,
    maxW = W - 120, stroke = 0, strokeColor = C.black, alpha = 1, baseline = 'alphabetic', shadow = 0, weight = '' } = o;
  if (TYPE.layer && TYPE.layer !== ctx && size >= TYPE.min) {
    const L = TYPE.layer; L.save();
    L.setTransform(ctx.getTransform()); L.globalAlpha = ctx.globalAlpha; L.globalCompositeOperation = ctx.globalCompositeOperation;
    const r = line(L, str, x, y, o); L.restore(); return r;
  }
  let s = size;
  setFont(ctx, family, s, weight);
  const measure = () => ctx.measureText(str).width + tracking * s * (str.length - 1);
  while (measure() > maxW && s > 20) { s -= 4; setFont(ctx, family, s, weight); }
  const w = measure();
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = shadow; ctx.shadowOffsetY = shadow * 0.25; }
  if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = strokeColor; ctx.lineJoin = 'round'; }
  if (!tracking) {
    ctx.textAlign = 'left';
    if (stroke) ctx.strokeText(str, cx, y);
    ctx.fillText(str, cx, y);
  } else {
    ctx.textAlign = 'left';
    for (const ch of str) {
      if (stroke) ctx.strokeText(ch, cx, y);
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + tracking * s;
    }
  }
  ctx.restore();
  return { width: w, size: s };
}

// Kinetic headline: each line rises out of a mask, staggered; `age` in seconds since cue.
// o.minSize (opt-in): a line that line() would shrink below minSize to fit is broken at its most balanced space
// into two stacked lines instead (one phrase, one frame; size follows the role, not the letter count).
// o.safe (opt-in, or TYPE.safe): the block is kept inside SAFE_BAND (last baseline <= 1250), centred on x 510, max 900 wide.
export function headline(ctx, lines, age, o = {}) {
  const safe = o.safe ?? TYPE.safe;
  let { y = H * 0.62, size = 190, gap = 0.92, stagger = 0.07, dur = 0.28, family = 'Anton',
    color = C.cream, out = null, highlight = null } = o;
  const cx = safe ? SAFE_BAND.cx : W / 2, maxW = safe ? SAFE_BAND.x2 - SAFE_BAND.x1 : (o.lineOpts && o.lineOpts.maxW) || W - 120;
  if (o.minSize) {
    setFont(ctx, family, size, (o.lineOpts && o.lineOpts.weight) || '');
    const out2 = [], hi2 = [];
    lines.forEach((ln, i) => {
      if (ctx.measureText(ln).width * (o.minSize / size) <= maxW || ctx.measureText(ln).width <= maxW || !ln.includes(' ')) { out2.push(ln); if (highlight && highlight.includes(i)) hi2.push(out2.length - 1); return; }
      const ws = ln.split(' '); let best = null;
      for (let k = 1; k < ws.length; k++) { const a = ws.slice(0, k).join(' '), b = ws.slice(k).join(' '), m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width); if (!best || m < best[0]) best = [m, a, b]; }
      out2.push(best[1], best[2]); if (highlight && highlight.includes(i)) hi2.push(out2.length - 2, out2.length - 1);
    });
    lines = out2; if (highlight) highlight = hi2;
  }
  if (safe) y = Math.min(Math.max(y, SAFE_BAND.y1 + size * 0.9), SAFE_BAND.y2 - (lines.length - 1) * size * gap);
  let yy = y;
  lines.forEach((ln, i) => {
    const a = ease.outExpo((age - i * stagger) / dur);
    if (a <= 0) { yy += size * gap; return; }
    const outA = out != null ? 1 - ease.inCubic((age - out) / 0.18) : 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yy - size * 0.98, W, size * 1.08);
    ctx.clip();
    const dy = (1 - a) * size * 1.05 - (1 - outA) * size * 1.05;
    const col = highlight && highlight.includes(i) ? C.red2 : color;
    line(ctx, ln, cx, yy + dy, { family, size, color: col, ...o.lineOpts, ...(safe ? { maxW, shadow: 0 } : {}) });
    ctx.restore();
    yy += size * gap;
  });
}

// ---------------------------------------------------------------- finish
// Grain as delivered (STUDIO FINISH c1, 1 Oct): the tiles are 2 px grain (128^2 noise, smoothly doubled, contrast
// restored to the 1 px tile's spread) and the pattern boils on twos. A fresh 1 px pattern every frame was the most
// expensive thing in the frame to encode, and at share / platform bitrates it came out as soft mottle; this is the
// same amount of grain in a form that survives the encode. Same seeds, same amounts, same call.
export class Finish {
  constructor(seed = 3) {
    const r = rng(seed);
    this.tiles = [];
    for (let k = 0; k < 6; k++) {
      const s = document.createElement('canvas'); s.width = s.height = 128;
      const sg = s.getContext('2d'), sd = sg.createImageData(128, 128);
      for (let i = 0; i < sd.data.length; i += 4) { const v = r() * 255; sd.data[i] = sd.data[i + 1] = sd.data[i + 2] = v; sd.data[i + 3] = 255; }
      sg.putImageData(sd, 0, 0);
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
      for (const [dx, dy] of [[0, 0], [-256, 0], [0, -256], [-256, -256], [256, 0], [0, 256], [256, 256], [-256, 256], [256, -256]])
        g.drawImage(s, dx, dy, 256, 256);                                    // wrap, so the doubled tile still tiles
      const id = g.getImageData(0, 0, 256, 256);
      let m = 0, v2 = 0; const n = id.data.length / 4;
      for (let i = 0; i < id.data.length; i += 4) { m += id.data[i]; v2 += id.data[i] * id.data[i]; }
      m /= n; const sdv = Math.sqrt(Math.max(1, v2 / n - m * m)), k2 = 73.6 / sdv;   // 73.6 = sd of uniform 0..255
      for (let i = 0; i < id.data.length; i += 4) { const v = Math.max(0, Math.min(255, 127.5 + (id.data[i] - m) * k2)); id.data[i] = id.data[i + 1] = id.data[i + 2] = v; }
      g.putImageData(id, 0, 0);
      this.tiles.push(c);
    }
    const v = document.createElement('canvas');
    v.width = W; v.height = H;
    const g = v.getContext('2d');
    const grd = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.65)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    this.vig = v;
  }
  apply(ctx, frame, { grain = 0.07, vignette = 1, flash = 0 } = {}) {
    if (vignette) { ctx.globalAlpha = vignette; ctx.drawImage(this.vig, 0, 0); ctx.globalAlpha = 1; }
    if (grain) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = grain;
      const f2 = frame >> 1;                                                   // on twos
      const tile = this.tiles[f2 % this.tiles.length];
      const pat = ctx.createPattern(tile, 'repeat');
      ctx.fillStyle = pat;
      ctx.translate((f2 * 37) % 256, (f2 * 91) % 256);
      ctx.fillRect(-256, -256, W + 512, H + 512);
      ctx.restore();
    }
    if (flash > 0) { ctx.fillStyle = `rgba(244,230,208,${clamp(flash)})`; ctx.fillRect(0, 0, W, H); }
  }
}

// ---------------------------------------------------------------- marks
// ☭≡/acc: the movement's lockup (ACP gear, hammer and sickle + ≡ + /acc), cut from the
// official banner. White masks are tinted on demand and cached per colour.
export const BRAND = {};
export async function loadBrand() {
  const base = '../assets/';
  for (const k of ['acc_lockup', 'acp_mark', 'acc_tagline', 'acp_logo']) BRAND[k] = await loadImage(base + k + '.png');
  // the ACP emblem: the gear, hammer and sickle with the flag's FOUR stripes, cut from acp_logo.png above the letters
  const L = BRAND.acp_logo, e = document.createElement('canvas'), sh = Math.round(L.height * 0.62);
  e.width = L.width; e.height = sh; const eg = e.getContext('2d'); eg.drawImage(L, 0, 0, L.width, sh, 0, 0, L.width, sh);
  const id = eg.getImageData(0, 0, e.width, sh);                      // drop the logo's faint glow so a tint reads as a clean silhouette
  for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] < 64 ? 0 : Math.min(255, (id.data[i] - 64) * 1.34);
  eg.putImageData(id, 0, 0);
  BRAND.acp_emblem = e; BRAND.acp_emblem.src = 'acp_emblem';
}
const tintCache = new Map();
export function tinted(img, color) {
  const key = img.src + color;
  if (!tintCache.has(key)) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    tintCache.set(key, c);
  }
  return tintCache.get(key);
}
// size = lockup height in px. Mark can take its own colour (e.g. red mark, cream ≡/acc).
export function sigil(ctx, cx, cy, size, { color = C.cream, accent = null, alpha = 1, tagline = false } = {}) {
  if (TYPE.layer && TYPE.layer !== ctx && size >= TYPE.min) {       // the lockup is type too: keep it out of the damage
    const T = TYPE.layer; T.save();
    T.setTransform(ctx.getTransform()); T.globalAlpha = ctx.globalAlpha; T.globalCompositeOperation = ctx.globalCompositeOperation;
    sigil(T, cx, cy, size, { color, accent, alpha, tagline }); T.restore(); return;
  }
  const L = BRAND.acc_lockup, M = BRAND.acp_mark;
  const w = L.width * size / L.height;
  ctx.save(); ctx.globalAlpha *= alpha;
  if (globalThis.__acpRaster) {
    ctx.drawImage(tinted(L, color), cx - w / 2, cy - size / 2, w, size);
    if (accent) ctx.drawImage(tinted(M, accent), cx - w / 2, cy - size / 2, M.width * size / L.height, size);
  } else _vLock(ctx, cx, cy, size, { color, accent });
  if (tagline) {
    const T = BRAND.acc_tagline, tw = w * 1.02, th = T.height * tw / T.width;
    ctx.drawImage(tinted(T, color), cx - tw / 2, cy + size * 0.72, tw, th);
  }
  ctx.restore();
}

// The ACP logo without its letters: gear, hammer and sickle and the FOUR flag stripes (never three; the ≡ belongs to
// the ☭≡/acc wordmark only, so never compose acp_mark + part_eq as an ACP logo). size = emblem height in px; one flat
// colour (a white/cream/ink silhouette), or color = null for the logo's own red. Use this wherever a scene wants the
// ACP logo with stripes; use BRAND.acp_mark for the gear alone.
export function acpEmblem(ctx, cx, cy, size, { color = C.cream, alpha = 1 } = {}) {
  const E = BRAND.acp_emblem, w = E.width * size / E.height;
  ctx.save(); ctx.globalAlpha *= alpha;
  if (globalThis.__acpRaster) ctx.drawImage(color ? tinted(E, color) : E, cx - w / 2, cy - size / 2, w, size);
  else _vMark(ctx, cx, cy, size, { color: color || _VRED });
  ctx.restore();
}

// ACP sign-off: logo, OWN THE FUTURE, red bar, JOIN THE FIGHT AT ACP.US
export function signoff(ctx, age, logo, { tagline = null, bg = C.black, sig = true } = {}) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const a = ease.outExpo(age / 0.5);
  const L = 400;
  ctx.globalAlpha = clamp(age * 4);
  ctx.drawImage(logo, W / 2 - L / 2, 250 - (1 - a) * 60, L, L);
  ctx.globalAlpha = 1;
  headline(ctx, ['OWN THE', 'FUTURE'], age - 0.08, { y: 930, size: 230, gap: 0.9 });
  const bx = (1 - ease.outExpo((age - 0.25) / 0.4)) * W;
  ctx.fillStyle = C.red;
  ctx.beginPath();
  ctx.moveTo(60 + bx, 1230); ctx.lineTo(W - 20 + bx, 1230); ctx.lineTo(W - 60 + bx, 1330); ctx.lineTo(20 + bx, 1330);
  ctx.fill();
  line(ctx, 'BUILD THE FUTURE WITH THE WORKING CLASS', W / 2 + bx, 1300, { size: 58, color: '#fff', maxW: W - 160 });
  line(ctx, 'JOIN THE FIGHT AT ACP.US', W / 2, 1470, { family: 'Archivo Black', size: 64, color: C.cream,
    alpha: clamp((age - 0.45) * 4) });
  if (sig) sigil(ctx, W / 2, 1680, 120, { accent: C.red2, alpha: clamp((age - 0.8) * 3) });
}

// Scene bootstrap: output canvas + readiness flag.
export function outCanvas() {
  const c = document.getElementById('out');
  c.width = W; c.height = H;
  return c.getContext('2d');
}

// ---------------------------------------------------------------- cues: one short line per frame
// seq(startBeat, [[beats, 'TEXT', red?], ...]) -> [{s, e, text, red}] in beats, back to back.
export function seq(start, items) {
  const out = []; let b = start;
  for (const [n, text, red] of items) { out.push({ s: b, e: b + n, text, red: !!red }); b += n; }
  return out;
}
// Draw whichever cue is live: one big line that punches up out of a mask.
// opt-in { safe: true } (or TYPE.safe): inside SAFE_BAND, no drop shadow, and a line too long for its size breaks
// in two (minSize = 0.8 size) instead of shrinking. A cue flagged { slam: true } (or shorter than 0.5 s) is a chant
// slam: on for 6 frames from its beat, then clear, whatever its cue length.
export function cue(ctx, cues, beat, spb, { y = 1480, size = 250, color = C.cream, red = C.red2, shadow = 40, family = 'Anton', weight = '', stroke = 0, redStroke = '#0b0303', safe = TYPE.safe } = {}) {
  for (const c of cues) if (beat >= c.s && beat < c.e) {
    const age = (beat - c.s) * spb, hold = c.slam ? Math.min((c.e - c.s) * spb, 0.2) : (c.e - c.s) * spb;
    if (age >= hold && c.slam) continue;
    headline(ctx, [c.text], age, { y, size, dur: c.slam ? 0.05 : 0.16, out: Math.max(0.12, hold - 0.1), family, safe, minSize: safe ? size * 0.8 : 0,
      color: c.red ? red : color, lineOpts: { shadow, maxW: W - 100, weight, stroke, strokeColor: c.red ? redStroke : '#0b0303' } });
  }
}

// ---------------------------------------------------------------- shared scene pieces (round-1 rebuilds)
// The banner lockup: red field, dark square, red inner square, ☭≡/acc + tagline.
export function banner(ctx, age) {
  ctx.fillStyle = '#d4101c'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 800, 50, W / 2, 800, 700);
  g.addColorStop(0, '#2a0205'); g.addColorStop(1, '#120102');
  ctx.fillStyle = g; ctx.fillRect(110, 330, W - 220, 1000);
  ctx.fillStyle = '#d4101c'; ctx.fillRect(330, 560, 420, 460);
  const a = ease.outExpo(clamp(age / 0.6));
  sigil(ctx, W / 2, 800, 220 * lerp(1.3, 1, a), { color: C.cream, alpha: a, tagline: true });
}
// Ken Burns: draw img cover-fitted, zoomed from z0 to z1 over u in [0,1], toward focus (fx, fy in 0..1).
export function kenburns(ctx, img, u, z0 = 1, z1 = 1.2, fx = 0.5, fy = 0.5, punch = 0) {
  const z = lerp(z0, z1, clamp(u)) * (1 + punch);
  const s = Math.max(W / img.width, H / img.height) * z;
  const w = img.width * s, h = img.height * s;
  const x = clamp(W / 2 - fx * w + (fx - 0.5) * W * 0, W - w, 0), y = clamp(H / 2 - fy * h + (fy - 0.5) * 0, H - h, 0);
  ctx.drawImage(img, lerp((W - w) / 2, x, 0.6), lerp((H - h) / 2, y, 0.6), w, h);
}
// Heat-camera readout: temperature, emissivity, crosshair, corner brackets.
export function hud(ctx, t, temp, tx = W / 2, ty = H / 2, label = null, color = '#ffffff') {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 4;
  line(ctx, `${temp.toFixed(1)}°C`, 40, 110, { family: 'Plex Mono', size: 70, align: 'left', color });
  line(ctx, 'ε=0.95', W - 330, 100, { family: 'Plex Mono', size: 40, align: 'left', color });
  const r = 56;
  for (const [a, b, c, d] of [[-r, 0, -16, 0], [16, 0, r, 0], [0, -r, 0, -16], [0, 16, 0, r]]) { ctx.beginPath(); ctx.moveTo(tx + a, ty + b); ctx.lineTo(tx + c, ty + d); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(tx, ty, 26, 0, Math.PI * 2); ctx.stroke();
  if (label) line(ctx, label, tx + 40, ty + 60, { family: 'Plex Mono', size: 32, align: 'left', color });
  for (const [x, y, sx, sy] of [[24, 150, 1, 1], [W - 24, 150, -1, 1], [24, H - 110, 1, -1], [W - 24, H - 110, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60 * sx, y); ctx.moveTo(x, y); ctx.lineTo(x, y + 60 * sy); ctx.stroke();
  }
  ctx.restore();
}
// Column melt of the current frame (dir 1 = down).
const _mb = document.createElement('canvas'); _mb.width = W; _mb.height = H; const _mg = _mb.getContext('2d');
export function meltFrame(ctx, amount, t, dir = 1, fill = '#1a0204') {
  if (amount <= 0) return;
  _mg.clearRect(0, 0, W, H); _mg.drawImage(ctx.canvas, 0, 0);
  ctx.fillStyle = fill; ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 12) {
    const n = Math.sin(x * 0.013 + t * 0.7) * 0.5 + Math.sin(x * 0.041 + 1.3) * 0.3 + Math.sin(x * 0.11) * 0.2;
    const off = amount * H * 0.55 * Math.pow(clamp(0.5 + n * 0.8), 2);
    ctx.drawImage(_mb, x, 0, 12, H, x, dir * off, 12, H);
    ctx.drawImage(_mb, x, dir > 0 ? 0 : H - 2, 12, 2, x, dir > 0 ? 0 : H - off, 12, off);
  }
}
// A plain standing figure, and a rising crowd of them.
export function figure(ctx, x, y, s, color, a = 1) {
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y - s * 0.66, s * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - s * 0.34, y + s * 0.5); ctx.lineTo(x - s * 0.3, y - s * 0.3); ctx.quadraticCurveTo(x, y - s * 0.5, x + s * 0.3, y - s * 0.3);
  ctx.lineTo(x + s * 0.34, y + s * 0.5); ctx.fill(); ctx.restore();
}
export function crowdRise(ctx, u, { n = 110, y0 = 900, y1 = 1320, seed = 8, colors = [C.cream, C.red2] } = {}) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * W, start = H + 100 + r() * 400, target = lerp(y0, y1, r());
    figure(ctx, x, lerp(start, target, ease.outCubic(clamp(u * 1.5 - r() * 0.5))), lerp(70, 130, r()), i % 7 ? colors[0] : colors[1]);
  }
}

// Short closer (1.4 s): the ☭≡/acc lockup slams in on black, ACP.US beneath. Replaces the long sign-off card.
export function closer(ctx, age) {
  if (typeof globalThis.__acpCloser === 'function' && globalThis.__acpCloser(ctx, age) !== false) return;   // CLOSER c1: a piece may install its own
  ctx.fillStyle = '#070101'; ctx.fillRect(0, 0, W, H);
  const k = Math.exp(-age * 10), a = ease.outExpo(clamp(age / 0.25));
  const s = 230 * (1 + 0.5 * k);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  sigil(ctx, W / 2 - 40 * k, 860, s, { color: '#ff1030', alpha: 0.7 * a });
  sigil(ctx, W / 2 + 40 * k, 860, s, { color: '#00d8ff', alpha: 0.45 * a });
  ctx.restore();
  sigil(ctx, W / 2, 860, s, { color: C.cream, accent: C.red2, alpha: a });
  line(ctx, 'ACP.US', W / 2, 1190, { family: 'Archivo Black', size: 76, color: C.cream, alpha: clamp((age - 0.3) * 5) });
}
