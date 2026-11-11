// LAB TYPE: eight 3-word frames, eight ways of moving letters, on the productive() track (now the m2 song, 130 BPM; everything is beat-relative).
// Each frame has its own spatial grammar (no two share the centred-radial staging):
//  0 DRAW-ON    WE BUILD EVERYTHING   orthogonal drawing board, raking lamp, set square cropped at the edge
//  8 SLAM       MORE STEEL NOW        Constructivist diagonal: the block tilted, heat seen through a wedge, type bleeding off
// 16 MASK/HEAT  RUN IT HOT            off-axis horizon, flush-left type bleeding off the left edge, stepped offset echoes
// 24 SHATTER    BREAK THE BANKS       banknote plate tilted and hard-cropped (rosette off the right edge), shards with depth
// 32 PRESS      OWN THE FUTURE        two-colour letterpress: diagonal red plate, misregistered black, paper grain
// 40 FOOTAGE    WE ARE MANY           letterboxed film bands, giant cropped windows onto graded riders footage
// 48 MARCH      ORGANIZE THE MAJORITY echoes recede to an off-axis vanishing point over a tilted grid horizon
// 56 3D         THE GIANT WAKES       worm's-eye monument over a tilted steppe horizon, glyphs settle one by one, then orbit
// 64 closer
// Every beat is guarded by window.readability(t) (tools/readable.mjs, run by scripts/sheet.sh).
import { W, H, C, loadFonts, loadBeats, BRAND, clamp, lerp, ease, rng, line, Finish, closer, outCanvas, loadImage, tinted } from '../lib/kit.js';
import { Heat, FIELD, PAL, sliceGlitch, riders } from '../lib/heat.js';
import { TYPE_OPTS, cpuOut, canvas2d, loadFace, shape, glyphs, look, springs, slam, drawOn, mask, Shatter, Type3D, wordPath, spring, mapTf, readable, prewarm } from '../lib/fx/type.js';
import { seq, guilloche, drawingBoard, construction, printerMarks, debris, shockRing, sparks, paperStock, inkPattern, printGrain,
  diagonalGrid, wedgePath, scanlines, drawOnReadable, halftoneRamp, finishPlate } from '../lib/fx/type_sets.js';

const Q = new URLSearchParams(location.search);
const CPU = Q.get('cpu') !== '0';
const BLUR = Number(Q.get('blur') ?? 4);          // shutter samples for glyphs()/Shatter (0 = off, for A/B timing)
TYPE_OPTS.cpuCanvas = CPU;
if (CPU) cpuOut();
const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('lab_type');
const spb = B.spb;
// hit names differ between the v1 productive() song and its m2 replacement: take the first one the beat map has
const hit = (...names) => names.find(n => B.hits[n]) || names[0];
const H_COW = hit('cowm', 'cowbell'), H_TAIKO = hit('taiko', 'stamp'), H_SCREECH = hit('screech', 'zap');
const finish = finishPlate({ seed: 11 });   // vignette + grain baked into plates: one drawImage per frame (kit Finish: two full-frame passes, one 'overlay')
const heat = new Heat(0.2);         // ONE render per frame (heat.render), shared by background and every masked word
const [shoulders, anton, bebas, playfair, playfairI, cinzel, michroma, plex] = await Promise.all(
  ['shoulders', 'anton', 'bebas', 'playfair', 'playfairItalic', 'cinzel', 'michroma', 'plex'].map(loadFace));
const T3 = await Type3D.create({ scale: 0.75 });
T3.key.intensity = 2.2; T3.scene.environmentIntensity = 0.3; T3.renderer.toneMappingExposure = 0.8; T3.rim.intensity = 6;
// riders footage, pre-graded offline (scripts/grade_riders.py): no per-frame grading
const FR = Array.from({ length: 14 }, (_, i) => String(i * 2 + 1).padStart(4, '0'));
const [graded, dark, dim] = await Promise.all(['riders_graded', 'riders_dark', 'riders_dim'].map(d => Promise.all(FR.map(f => loadImage(`../assets/${d}/${f}.jpg`)))));

const cover = (g, img, z = 1, fx = 0.5, fy = 0.5) => {
  const s = Math.max(W / img.width, H / img.height) * z, w = img.width * s, h = img.height * s;
  g.drawImage(img, (W - w) * fx, (H - h) * fy, w, h);
};
const fullRect = (g, c) => { g.fillStyle = c; g.fillRect(0, 0, W, H); };
const tex = (g, T, a = 1) => { g.save(); g.globalAlpha *= a; g.imageSmoothingEnabled = true; g.drawImage(T, 0, 0, W, H); g.restore(); };
const SH = { shutter: BLUR };
// ?prof=1: time named steps (each flushed with a 1-px read so deferred canvas work is counted where it happens)
const PROF = Q.has('prof') ? {} : null;
const tm = (k, f) => { if (!PROF) return f(); ctx.getImageData(0, 0, 1, 1); const s = performance.now(); const r = f(); ctx.getImageData(0, 0, 1, 1); PROF[k] = (PROF[k] || 0) + performance.now() - s; return r; };
window.__prof = () => { const r = PROF && { ...PROF }; if (PROF) for (const k in PROF) delete PROF[k]; return r; };

// ================================================================ 0: DRAW-ON  WE BUILD EVERYTHING
const S0 = [
  shape(shoulders, 'WE', { size: 560, x: 70, align: 'left', y: 470, valign: 'center' }),
  shape(shoulders, 'BUILD', { size: 900, maxW: 990, y: 1000, valign: 'center' }),
  shape(shoulders, 'EVERYTHING', { size: 600, maxW: 1000, y: 1500, valign: 'center' }),
];
const S0fill = [look.inline(C.cream, C.red2, 9, 5), look.inline(C.red2, C.cream, 12, 5), look.inline(C.cream, C.red2, 7, 4)];
const S0dur = [1.0, 2.2, 2.8];
const Q0 = seq(S0, B, { start: 0, onBeat: [0, 1.0, 3.0], end: 8, read: c => drawOnReadable(c.word, c.age / (S0dur[c.i] * spb), { overlap: 0.6, at: 0.75 }) });
function seg0(g, a, t, frame) {
  const pulse = B.env(H_COW, t, 14);
  tm('board', () => drawingBoard(g, { beat: a, pulse }));
  for (const c of Q0.at(t)) {
    if (c.age <= 0) continue;
    const u = c.age / (S0dur[c.i] * spb);
    tm('constr', () => construction(g, c.word, { alpha: clamp(u * 3) * (1 - 0.65 * clamp((u - 1) * 2)) * (0.8 + 0.2 * pulse), label: ['WE · 2 GLYPHS', 'BUILD · 5 GLYPHS', 'EVERYTHING · 10 GLYPHS'][c.i] }));
    const tips = drawOn(g, c.word, clamp(u), { color: C.cream, width: 3.5, overlap: 0.6, fill: S0fill[c.i], fillFrom: 0.72, glow: 34 });
    sparks(g, tips, { seed: frame, n: 4, len: 44 });
  }
}

// ================================================================ 1: SLAM  MORE STEEL NOW  (Constructivist diagonal)
const ANG1 = -0.2;
const S1 = [
  shape(anton, 'MORE', { size: 360, x: 60, align: 'left', y: 520, valign: 'center', tracking: 0.02 }),
  shape(anton, 'STEEL', { size: 1000, maxW: 1090, y: 980, valign: 'center' }),
  shape(anton, 'NOW', { size: 520, x: W - 50, align: 'right', y: 1450, valign: 'center' }),
];
const S1from = [4.5, 3.2, 4];
const S1look = [
  look.extrude(look.inline(C.cream, '#0b0303', 7, 3), '#9a1020', '#1a0204', 34, Math.PI * 0.32, 2),
  look.extrude(look.chrome({ top: '#fffaf0', mid: '#c9b8a8', horizon: '#2a0508', low: '#f0b080' }), '#8a0f1c', '#120102', 56, Math.PI * 0.32, 2),
  look.extrude(look.inline(C.red2, C.cream, 10, 5), '#4a0508', '#0a0101', 44, Math.PI * 0.32, 2),
].map((l, k) => look.cache(l, { pad: 70, res: 1, peak: Math.min(3, S1from[k]) }));   // 2-level mip: crisp at the top of the slam
// slams land ON the kick: word i on every 2nd kick from beat 8; the clock leads by the fall time
const Q1 = seq(S1, B, { start: 8, onBeat: 'kick', every: 2, end: 8, lead: 0.12,
  effect: (age, i, c) => slam(age, { from: S1from[i], fall: 0.12, stagger: [0.05, 0.04, 0.06][i], mode: ['ltr', 'center', 'random'][i], seed: 9 + i, out: (16 - c.beat) * spb - 0.08 }) });
const band1 = wedgePath({ cx: W / 2, cy: 1000, angle: ANG1, th: 820 });
function seg1(g, a, t, frame) {
  const kick = B.env('kick', t, 10), cues = Q1.at(t);
  const imp = cues.reduce((m, c) => Math.max(m, c.tf ? c.tf.impact(c.word.n) : 0), 0);
  const T = tm('heat', () => heat.render(t, { field: FIELD.pour, pal: PAL.ironbow, zoom: 1.15 + 0.12 * kick + a * 0.02, kick, hot: 0.05 + 0.2 * imp, seed: 3 }));
  fullRect(g, '#0a0203');
  tm('grid', () => diagonalGrid(g, { angle: ANG1, gap: 64, color: 'rgba(244,230,208,0.06)', majorColor: 'rgba(201,31,55,0.28)' }));
  // darken the small texture itself (216x384 fill) instead of a clipped full-frame fill
  tm('band', () => { const tg = T.getContext('2d'); tg.fillStyle = 'rgba(10,0,2,0.35)'; tg.fillRect(0, 0, T.width, T.height); g.save(); g.clip(band1); tex(g, T); g.restore(); });
  // hard red bar on the counter-diagonal, cropped by the frame
  g.save(); g.translate(W * 0.78, 300); g.rotate(ANG1 + Math.PI / 2 - 0.35); g.fillStyle = C.red2; g.fillRect(-60, -1400, 120, 2800); g.restore();
  const r = rng(frame), sx = (r() - 0.5) * 50 * imp, sy = (r() - 0.5) * 40 * imp;
  g.save(); g.translate(W / 2 + sx, H / 2 + sy); g.rotate(ANG1); g.translate(-W / 2, -H / 2);
  for (const c of cues) {
    if (!c.tf) continue;
    shockRing(g, c.word.bbox.x1 + (c.word.bbox.x2 - c.word.bbox.x1) / 2, c.word.bbox.y2 + 20, c.age - 0.12, { max: 800 });
    tm('slam', () => glyphs(g, c.word, c.tf, S1look[c.i], { shutter: BLUR && BLUR + 1 }));   // 5 samples: slams move furthest per frame
    debris(g, c.word, c.age - 0.12, { seed: 40 + c.i });
  }
  // caption strip rides the diagonal
  g.fillStyle = C.red2; g.fillRect(-200, 1700, W + 400, 70);
  line(g, 'NO DEGROWTH · 1538°C · NO DEGROWTH · 1538°C · NO DEGROWTH · 1538°C', W / 2 - ((t * 240) % 600) + 300, 1752, { family: 'Archivo Black', size: 40, color: C.cream, maxW: 4000 });
  g.restore();
}

// ================================================================ 2: MASK  RUN IT HOT  (off-axis horizon, flush-left, stepped echoes)
const S2 = [
  shape(bebas, 'RUN', { size: 800, x: -24, align: 'left', y: 450, valign: 'center' }),
  shape(bebas, 'IT', { size: 420, x: W - 60, align: 'right', y: 905, valign: 'center' }),
  shape(bebas, 'HOT', { size: 800, x: -24, align: 'left', y: 1400, valign: 'center' }),
];
const S2from = [{ dx: -1300, skx: 0.5 }, { dx: 900, s: 1.6 }, { dx: -1300, skx: -0.5 }];
const Q2 = seq(S2, B, { start: 16, onBeat: [0, 1.5, 3], end: 8,
  effect: (age, i) => springs(age, { from: S2from[i], stagger: 0.035, f: 2.6, z: 0.55, mode: i === 1 ? 'rtl' : 'ltr' }) });
const horizon2 = (() => { const p = new Path2D(); p.moveTo(0, 1235); p.lineTo(W, 1130); p.lineTo(W, H); p.lineTo(0, H); p.closePath(); return p; })();
const KO = look.cache(look.knockout('#070102', 12), { pad: 20 }), OUT2 = look.outline('rgba(255,236,200,0.9)', 3);
const ECHO2 = look.cache(look.outline(C.red2, 3), { pad: 8 });
function seg2(g, a, t, frame) {
  const kick = B.env('kick', t, 9), shout = B.env('shout', t, 7), cues = Q2.at(t).filter(c => c.tf);
  const inv = (a >= 5 && a < 5.5) || (a >= 7 && a < 7.5);
  const T = tm('heat', () => heat.render(t, { field: FIELD.pour, pal: PAL.ironbow, zoom: 0.85 + 0.06 * kick + a * 0.015, kick, hot: 0.25 + 0.3 * shout + (inv ? 0.25 : 0), warp: 1.3, seed: 12 }));
  if (inv) {
    tex(g, T);
    for (const c of cues) glyphs(g, c.word, c.tf, look.stack(look.fill('#070102'), look.outline(C.cream, 5)), SH);
  } else {
    fullRect(g, '#070102');
    g.save(); g.clip(horizon2); tex(g, T, 0.3); g.restore();
    g.save(); g.strokeStyle = `rgba(255,170,90,${0.6 + 0.4 * kick})`; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 1235); g.lineTo(W, 1130); g.stroke(); g.restore();
    // stepped offset echoes (down-right, like a stack of plates) instead of concentric rings
    for (let k = 4; k >= 1; k--) for (const c of cues)
      tm('echo', () => glyphs(g, c.word, mapTf(c.tf, q => ({ ...q, dx: (q.dx || 0) + k * (14 + 5 * kick), dy: (q.dy || 0) + k * (14 + 5 * kick), alpha: (q.alpha ?? 1) * (0.95 - k * 0.18) })), ECHO2));
    for (const c of cues) tm('ko', () => glyphs(g, c.word, c.tf, KO));
    const p = new Path2D(); for (const c of cues) wordPath(c.word, c.tf, p);
    tm('mask', () => mask(g, p, null, T));                                   // clip + one drawImage of the shared heat texture
    for (const c of cues) glyphs(g, c.word, c.tf, OUT2);
  }
  line(g, 'T = 1538°C   ε = 0.95   IRONBOW', W - 50, 1840, { family: 'Plex Mono', size: 28, align: 'right', color: 'rgba(244,230,208,0.7)' });
}

// ================================================================ 3: SHATTER  BREAK THE BANKS  (tilted, cropped banknote)
const S3 = [
  shape(playfair, 'BREAK', { size: 340, maxW: 960, x: 60, align: 'left', y: 560, valign: 'center' }),
  shape(playfairI, 'the', { size: 250, x: W - 90, align: 'right', y: 880, valign: 'center' }),
  shape(playfair, 'BANKS', { size: 340, maxW: 960, x: 60, align: 'left', y: 1230, valign: 'center' }),
];
const engr = [look.hatch(C.cream, '#2a0a0c', { gap: 6, w: 1.6, ang: -0.55, edge: '#0b0303', edgeW: 3 }),
  look.hatch(C.red2, '#3a0006', { gap: 6, w: 1.4, ang: 0.6, edge: '#0b0303', edgeW: 2 }),
  look.hatch(C.cream, '#2a0a0c', { gap: 6, w: 1.6, ang: -0.55, edge: '#0b0303', edgeW: 3 })];
const S3origin = S3.map((w, k) => ({ x: lerp(w.bbox.x1, w.bbox.x2, [0.3, 0.6, 0.45][k]), y: w.bbox.y2 + 30 }));
const S3sh = S3.map((w, k) => new Shatter(w, engr[k], { n: 22, seed: 70 + k, focus: S3origin[k], thick: 14, side: '#1e0306', back: '#5a3a30', edge: '#ff6a3a' }));
const plate3 = guilloche({ seed: 3 });
const S3in = [0, 0.5, 1.0], S3break = [5.5, 6.25, 7.3], ASM = 0.35;       // assemble in < 1 beat, blow apart late
const BRK = { force: 1500, spin: 7, gravity: 1600, fade: 1.0 };
const ASMO = { origin: { x: W * 0.3, y: H / 2 }, force: -900, spin: 3, tumble: 0.6, gravity: 0, fade: 99 };
// assembly clock: ease-out (shards rush in, then settle), so the word reads ~0.12 s after the cut instead of 0.3 s
const asmTau = el => ASM * (1 - clamp(el / ASM)) ** 2;
const Q3 = seq(S3, B, { start: 24, onBeat: S3in, end: 8, read: c => {
  const br = (24 + S3break[c.i]) * spb - c.t0, el = c.age;
  return el < ASM ? S3sh[c.i].readable(asmTau(el), ASMO) : el > br ? S3sh[c.i].readable(el - br, { ...BRK, origin: S3origin[c.i] }) : 1; } });
function seg3(g, a, t, frame) {
  const kick = B.env('kick', t, 9);
  g.save(); g.translate(W / 2, H / 2); g.rotate(-0.07 + a * 0.004); const z = 1.12 + 0.02 * kick; g.scale(z, z); g.drawImage(plate3, -W / 2, -H / 2); g.restore();
  let flash = 0;
  for (const c of Q3.at(t)) {
    if (c.age <= 0) continue;
    const k = c.i, br = c.age - (S3break[k] - S3in[k]) * spb;
    if (br > 0) {
      flash = Math.max(flash, Math.exp(-br * 14));
      S3sh[k].draw(g, br, { ...BRK, origin: S3origin[k], edge: '#ff6a3a', ...SH, shutter: Math.min(3, BLUR) });
    } else if (c.age < ASM) {
      S3sh[k].draw(g, asmTau(c.age), { ...ASMO, edge: '#ff6a3a', dir: -1, ...SH, shutter: Math.min(3, BLUR) });
    } else {
      const crack = clamp((a - (S3break[k] - 1.2)) / 1.2);
      S3sh[k].draw(g, 0, { edge: '#ff6a3a', crack: crack * (0.6 + 0.4 * Math.sin(t * 40)) });
    }
  }
  if (flash > 0) { g.fillStyle = `rgba(255,120,60,${flash * 0.35})`; g.fillRect(0, 0, W, H); }
  printGrain(g, { kind: 'paper', alpha: 0.25, seed: 3, frame });
}

// ================================================================ 4: PRESS  OWN THE FUTURE  (two-colour letterpress)
const S4 = [
  shape(cinzel, 'OWN', { size: 420, maxW: 930, x: 70, align: 'left', y: 430, valign: 'center', tracking: 0.02 }),
  shape(cinzel, 'THE', { size: 150, y: 1000, valign: 'center', tracking: 0.3 }),
  shape(cinzel, 'FUTURE', { size: 360, maxW: 1050, y: 1290, valign: 'center' }),
];
const paper = paperStock({ seed: 21 });
const tint4 = halftoneRamp({ h: 520, color: 'rgba(179,20,31,0.85)', cell: 13, seed: 4 });
const tintCloser = halftoneRamp({ h: 760, color: '#4a0810', cell: 16, angle: -0.26, seed: 6, max: 0.55 });
const inkRed = inkPattern(ctx, { seed: 5 }), inkBlack = inkPattern(ctx, { seed: 8, color: '#151010', light: '120,100,90', dark: '0,0,0' });
const inkPlate = inkPattern(ctx, { seed: 9, color: '#c21a2c', n: 2200 });
const S4look = [
  look.cache(look.misreg(look.stack(look.inkSpread('#151010', { spread: 2.5, seed: 1, halo: 'rgba(10,0,0,0.35)' }), look.letterpress(inkBlack, { depth: 6, blur: 5 })), { color: 'rgba(244,230,208,0.55)', dx: -5, dy: 4 }), { pad: 30 }),
  look.cache(look.stack(look.inkSpread('#b3141f', { spread: 2 }), look.letterpress(inkRed, { depth: 5, blur: 4 })), { pad: 30 }),
  look.cache(look.misreg(look.stack(look.inkSpread('#b3141f', { spread: 3, seed: 4 }), look.letterpress(inkRed, { depth: 6, blur: 5 })), { color: 'rgba(21,16,16,0.75)', dx: 6, dy: -4 }), { pad: 30 }),
];
const plate4 = (() => { const p = new Path2D(); p.moveTo(-20, -20); p.lineTo(W + 20, -20); p.lineTo(W + 20, 700); p.lineTo(-20, 800); p.closePath(); return p; })();
const Q4 = seq(S4, B, { start: 32, onBeat: [0, 2, 4], end: 8, read: c => c.age > 0.12 ? 1 : 0 });
function seg4(g, a, t, frame) {
  const cues = Q4.at(t);
  const bump = cues.reduce((m, c) => Math.max(m, c.age > 0 ? Math.exp(-c.age * 18) : 0), 0);
  g.save(); g.translate(W / 2, H / 2); const z = 1.02 + 0.012 * bump; g.scale(z, z); g.translate(-W / 2, -H / 2);
  g.drawImage(paper, 0, 0);
  // red solid plate (diagonal foot), printed 4 px out of register against the black
  g.save(); g.translate(4, -3); g.fillStyle = inkPlate; g.fill(plate4); g.restore();
  g.save(); g.clip(plate4); printGrain(g, { kind: 'ink', alpha: 0.9, seed: 4, frame: 0, drift: false }); g.restore();
  g.drawImage(tint4, 0, H - 520);                         // printed tint screen under the emboss
  // blind emboss: the lockup pressed without ink, lower third
  const L = BRAND.acc_lockup, sw = 760, sh = L.height * sw / L.width, sy = 1640;
  g.save(); g.globalAlpha = 0.55 * clamp(a / 1.5);
  g.drawImage(tinted(L, 'rgba(255,255,250,1)'), W / 2 - sw / 2 - 3, sy - sh / 2 - 3, sw, sh);
  g.drawImage(tinted(L, 'rgba(120,80,50,1)'), W / 2 - sw / 2 + 3, sy - sh / 2 + 3, sw, sh);
  g.globalAlpha = 1; g.drawImage(tinted(L, '#efe0c7'), W / 2 - sw / 2, sy - sh / 2, sw, sh);
  g.restore();
  printerMarks(g, { top: 860 });
  g.save(); g.translate(40, 1560); g.rotate(-Math.PI / 2); line(g, 'LETTERPRESS · CINZEL 900 · 2 COLOURS · REG ±4', 0, 0, { family: 'Plex Mono', size: 18, align: 'left', color: 'rgba(30,10,10,0.55)' }); g.restore();
  const rr = ease.outExpo(cues[1].age / 0.3);
  if (cues[1].age > 0) { g.fillStyle = '#b3141f'; g.fillRect(W / 2 - 380 * rr, 925, 760 * rr, 7); g.fillRect(W / 2 - 380 * rr, 1068, 760 * rr, 7); }
  for (const c of cues) {
    const p = c.age;
    if (p <= 0) continue;
    if (p < 0.12) {        // the plate coming down: a soft shadow of the letters closing in
      const u = p / 0.12;
      glyphs(g, c.word, () => ({ s: lerp(1.25, 1, ease.inCubic(u)), alpha: 0.12 + 0.3 * u }), look.fill('rgba(60,10,10,0.6)'));
      continue;
    }
    const q = Math.exp(-(p - 0.12) * 20);
    glyphs(g, c.word, () => ({ s: 1 + 0.012 * q }), S4look[c.i]);
    if (q > 0.02) glyphs(g, c.word, () => ({ s: 1 + 0.03 * q, alpha: q * 0.5 }), look.fill(c.i === 0 ? 'rgba(21,16,16,0.5)' : 'rgba(179,20,31,0.5)'));   // ink squash
  }
  printGrain(g, { kind: 'paper', alpha: 0.55, seed: 7, frame: 0, drift: false });
  g.restore();
}

// ================================================================ 5: FOOTAGE  WE ARE MANY  (letterboxed film bands)
const S5 = [
  shape(anton, 'WE', { size: 1000, maxW: 1140, y: 560, valign: 'center' }),
  shape(anton, 'ARE', { size: 1000, maxW: 1140, y: 1330, valign: 'center' }),
];
const S5many = shape(anton, 'MANY', { size: 1300, maxW: 1060, y: 1060, valign: 'center' });
const S5small = shape(anton, 'WE ARE', { size: 190, y: 330, valign: 'center', tracking: 0.06 });
const S5sub = shape(plex, 'ONE FRONT · A MILE WIDE', { size: 44, y: 1640, valign: 'center', tracking: 0.08 });
const frameAt = (list, t, off = 0) => list[Math.floor(t * 12 + off) % list.length];
const Q5 = seq(S5, B, { start: 40, onBeat: [0, 2], end: 4, effect: age => springs(age, { from: { s: 0.5, dy: 160 }, stagger: 0.05, f: 2.4, z: 0.55, mode: 'center' }) });
const Q5b = seq([S5many], B, { start: 44, onBeat: [0], end: 4, lead: 0.1, effect: age => slam(age, { from: 2.6, fall: 0.1, stagger: 0.05, mode: 'center', squash: 0.2, seed: 3 }) });
const C5 = canvas2d(W / 2, H / 2);
const KO5 = look.cache(look.knockout('#050001', 14), { pad: 20, peak: 2.6 }), OUT5 = look.cache(look.outline('rgba(244,230,208,0.95)', 4), { pad: 8, peak: 2.6 });
const GHOST5 = [look.cache(look.outline('rgba(255,0,40,0.8)', 4), { pad: 8, peak: 2.6 }), look.cache(look.outline('rgba(0,220,255,0.55)', 4), { pad: 8, peak: 2.6 })];
function letterbox(g, a, t) {
  g.fillStyle = '#050001'; g.fillRect(0, 0, W, 130); g.fillRect(0, H - 130, W, 130);
  for (let x = 30; x < W; x += 70) { g.fillStyle = 'rgba(244,230,208,0.2)'; g.fillRect(x, 40, 36, 50); g.fillRect(x, H - 90, 36, 50); }
}
function seg5(g, a, t, frame) {
  const taiko = B.env(H_TAIKO, t, 8), kick = B.env('kick', t, 9), scr = B.env(H_SCREECH, t, 10);
  if (a < 4) {
    const z = 1.25 + a * 0.05 + 0.04 * taiko, F = frameAt(graded, t), D = frameAt(dark, t);
    cover(g, D, z, 0.5, 0.42);                               // outside: the same footage, crushed (pre-baked)
    scanlines(g);
    for (const c of Q5.at(t)) {
      if (!c.tf) continue;
      glyphs(g, c.word, c.tf, KO5);
      mask(g, c.word, c.tf, L => { cover(L, F, z, 0.5, 0.42); if (taiko > 0.05) { L.globalCompositeOperation = 'lighter'; L.fillStyle = `rgba(255,200,160,${0.25 * taiko})`; L.fillRect(0, 0, W, H); } });
      glyphs(g, c.word, c.tf, OUT5, SH);
    }
    letterbox(g, a, t);
    line(g, `${String(Math.floor(12 + a * 330)).padStart(6, '0')} RIDERS`, W - 40, H - 150, { family: 'Plex Mono', size: 40, align: 'right', color: C.cream });
  } else {
    const [c] = Q5b.at(t), tf = c.tf;
    cover(g, frameAt(dim, t, 3), 1.08 + 0.04 * kick, 0.5, 0.42);      // pre-dimmed offline (riders_dim): no full-frame wash
    if (tf) {
      const imp = tf.impact(S5many.n);
      const T = tm('heat', () => heat.render(t, { field: FIELD.steppe, pal: PAL.ironbow, zoom: 1, kick, hz: 0.25, seed: 5, hot: 0.1 }));
      tm('ko', () => glyphs(g, S5many, tf, KO5));           // plate under the (unblurred) window: no shutter
      // window content composed once at half res (heat texture + rider silhouettes, no clip), then ONE clipped drawImage
      tm('riders', () => { const c = C5.g; c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(T, 0, 0, W / 2, H / 2); c.setTransform(0.5, 0, 0, 0.5, 0, 0); riders(c, B, t, 3, false, H * 0.36, 7); });
      tm('mask', () => mask(g, S5many, tf, C5.cv));
      if (imp > 0.04) {        // RGB ghosts only on the hit, and small: the word stays sharp at rest
        g.save(); g.globalCompositeOperation = 'lighter';
        const off = (6 + 26 * scr) * imp;
        glyphs(g, S5many, mapTf(tf, q => ({ ...q, dx: (q.dx || 0) - off })), GHOST5[0]);
        glyphs(g, S5many, mapTf(tf, q => ({ ...q, dx: (q.dx || 0) + off })), GHOST5[1]);
        g.restore();
      }
      glyphs(g, S5many, tf, OUT5, SH);
    }
    const el = c.age;
    glyphs(g, S5small, springs(el, { from: { dy: -80 }, stagger: 0.03 }), look.stroked(C.cream, '#0b0303', 8));
    g.fillStyle = C.red2; g.fillRect(0, 1600, W, 80);
    glyphs(g, S5sub, springs(el - 0.15, { from: { dy: 60 }, stagger: 0.012 }), look.fill(C.cream));
    letterbox(g, a, t);
  }
}

// ================================================================ 6: MARCH  ORGANIZE THE MAJORITY  (off-axis vanishing point)
const S6 = [
  shape(michroma, 'ORGANIZE', { size: 150, maxW: 980, y: 1080, valign: 'center' }),
  shape(michroma, 'THE', { size: 300, y: 1080, valign: 'center' }),
  shape(michroma, 'MAJORITY', { size: 150, maxW: 980, y: 1080, valign: 'center' }),
];
const S6stack = [
  shape(michroma, 'ORGANIZE', { size: 150, maxW: 1000, x: 40, align: 'left', y: 820, valign: 'center' }),
  shape(michroma, 'THE', { size: 110, x: 44, align: 'left', y: 1000, valign: 'center', tracking: 0.3 }),
  shape(michroma, 'MAJORITY', { size: 150, maxW: 1000, x: 40, align: 'left', y: 1180, valign: 'center' }),
];
const VP = { x: W * 0.9, y: H * 0.16 };
const Q6 = seq(S6, B, { start: 48, onBeat: [0, 2, 4], hold: 2, end: 6,
  effect: age => springs(age, { from: { s: 0.35, dx: (VP.x - W / 2) * 0.55, dy: (VP.y - 1080) * 0.55 }, stagger: 0.02, f: 3.8, z: 0.68, mode: 'center' }) });
const Q6b = seq(S6stack, B, { start: 54, onBeat: [0, 0.08, 0.16], end: 2,
  effect: (age, i) => springs(age, { from: { dx: -560, skx: 0.3 }, stagger: 0.012, f: 5, z: 0.75, mode: 'rtl' }) });
const LIVE6 = look.cache(look.keyline(look.inline(C.cream, C.red2, 5, 3), '#0b0303', 12), { pad: 20 });
function seg6(g, a, t, frame) {
  const kick = B.env('kick', t, 9);
  const T = tm('heat', () => heat.render(t, { field: FIELD.grid, pal: PAL.infrared, zoom: 1.9 + 0.05 * kick, kick, hot: -0.12, seed: 4, rot: 0.34 }));
  tex(g, T); g.fillStyle = 'rgba(4,0,1,0.45)'; g.fillRect(0, 0, W, H);
  const step = Math.floor(a * 2), f = ease.outExpo((a * 2 - step) / 0.6), ph = step + f;   // eighth-note steps
  if (a < 6) {
    const c = Q6.at(t).find(q => q.live && q.tf), w = c ? c.word : S6[0];
    // echoes on a geometric ladder toward the off-axis vanishing point, far to near, all BEHIND the live word
    for (let j = 8; j >= -2; j--) {
      const s = Math.pow(0.74, j - (ph % 1));
      if (s > 0.8 && s < 1.35) continue;
      const idx = j - Math.floor(ph), dx = (VP.x - W / 2) * (1 - s), dy = (VP.y - 1080) * (1 - s);
      g.save(); g.globalAlpha = clamp(s * 5) * (s < 1 ? 0.25 + 0.45 * s : 0.22);
      tm('echo', () => glyphs(g, w, () => ({ s, dx, dy }), (cc, gl) => { cc.lineJoin = 'round'; cc.lineWidth = (s < 1 ? 2 : 3) / s; cc.strokeStyle = idx % 3 ? C.red2 : '#ff8a70'; cc.stroke(gl.path); }));
      g.restore();
    }
    if (c) tm('live', () => glyphs(g, w, c.tf, LIVE6, SH));
  } else {
    g.fillStyle = 'rgba(4,0,1,0.55)'; g.save(); g.translate(0, 1000); g.rotate(-0.06); g.fillRect(-100, -300, W + 200, 600); g.restore();
    g.fillStyle = C.red2; g.fillRect(0, 960, 520, 80);
    for (const c of Q6b.at(t)) if (c.tf) glyphs(g, c.word, c.tf, c.i === 1 ? look.fill(C.cream) : LIVE6, SH);
  }
  line(g, `STEP ${String(step).padStart(2, '0')}/16`, 50, 110, { family: 'Plex Mono', size: 30, align: 'left', color: 'rgba(244,230,208,0.7)' });
  line(g, '51% → 100%', W - 50, 110, { family: 'Plex Mono', size: 30, align: 'right', color: 'rgba(201,31,55,0.9)' });
}

// ================================================================ 7: 3D  THE GIANT WAKES  (worm's-eye, tilted horizon)
const S7 = [
  shape(anton, 'THE', { size: 200, x: 90, align: 'left', y: 520, valign: 'center', tracking: 0.08 }),
  shape(anton, 'GIANT', { size: 1000, maxW: 1060, y: 930, valign: 'center' }),
  shape(anton, 'WAKES', { size: 420, maxW: 860, x: W - 60, align: 'right', y: 1420, valign: 'center' }),
];
const M_red = T3.materials({ face: 0x9e0f1f, side: 0x1c0204, metal: 0.6, rough: 0.26 });
const M_cream = T3.materials({ face: 0xe8d6bc, side: 0x3a0c0a, metal: 0.35, rough: 0.35 });
const G7 = [T3.word(S7[0], { depth: 60, bevel: 5, mats: M_cream }), T3.word(S7[1], { depth: 180, bevel: 12, mats: M_red }), T3.word(S7[2], { depth: 110, bevel: 9, mats: M_cream })];
const S7at = [0, 0.75, 2.25], GST = 0.06, GF = 3.0, GZ = 0.72;     // one glyph at a time, near-critical springs
const orbitFrom = 4.25;                                            // beats: orbit only once every word is complete
const Q7 = seq(S7, B, { start: 56, onBeat: S7at, end: 8, read: c => { pose7(c.t0 + c.age); return T3.readable(G7[c.i]); } });
function pose7(t) {
  const a = t / spb - 56;
  G7.forEach((grp, k) => grp.glyphs.forEach((p, i) => {
    const el = (a - S7at[k]) * spb - i * GST, v = spring(el, GF, GZ);
    p.visible = el > 0;
    p.position.set(p.home.x, p.home.y - 700 * (1 - v), p.home.z - 260 * (1 - v));
    p.rotation.set((1 - v) * 1.3, (1 - v) * (i % 2 ? 0.5 : -0.5), 0);
  }));
  const o = ease.inOutCubic(clamp((a - orbitFrom) / 2));
  T3.root.rotation.set(-0.22 + 0.08 * o * Math.sin(t * 0.9), 0.3 * o * Math.sin(t * 0.7 + 1), 0);
  T3.root.position.set(0, -30, -60 * a);
  T3.key.position.set(-700 + Math.sin(t * 1.3) * 500, 900, 1400);
}
const moving7 = a => S7at.some((s, k) => { const el = (a - s) * spb; return el > 0 && el < G7[k].glyphs.length * GST + 0.45; });
function seg7(g, a, t, frame) {
  const kick = B.env('kick', t, 9), imp = B.env('impact', t, 4);
  const T = tm('heat', () => heat.render(t, { field: FIELD.steppe, pal: PAL.turrell, zoom: 0.95 + 0.02 * a, kick, seed: 8, hot: 0.05 + 0.25 * imp, hz: 0.1, rot: -0.09 }));
  tex(g, T); g.fillStyle = 'rgba(8,0,2,0.3)'; g.fillRect(0, 0, W, H);
  const hg = g.createLinearGradient(0, 1250, 0, 1650); hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.5, `rgba(255,90,40,${0.25 + 0.2 * kick})`); hg.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(W / 2, 1450); g.rotate(-0.09); g.fillStyle = hg; g.fillRect(-W, -200, W * 2, 400); g.restore();
  T3.root.visible = true;
  tm('3d', () => T3.drawBlur(g, BLUR && moving7(a) ? 2 : 1, dt => pose7(t + dt)));
  T3.root.visible = false;
}

// ================================================================ frame
const SEGS = [[seg0, Q0], [seg1, Q1], [seg2, Q2], [seg3, Q3], [seg4, Q4], [seg5, null], [seg6, null], [seg7, Q7]];
// Legibility of the frame at t: the best-reading word on stage (0..1). Sampled by tools/readable.mjs.
window.readability = t => {
  const beat = t / spb;
  if (beat >= 64) return 1;
  const s = Math.floor(beat / 8), a = beat - s * 8;
  if (s === 5) return a < 4 ? Q5.readable(t) : Q5b.readable(t);
  if (s === 6) return a < 6 ? Q6.readable(t) : Q6b.readable(t);
  const r = SEGS[s][1].readable(t);
  if (s === 7) T3.root.visible = false;
  return r;
};
window.renderFrame = async (t) => {
  const t0 = performance.now();
  const beat = B.beat(t), frame = Math.round(t * 30);
  ctx.save();
  if (beat >= 64) {
    closer(ctx, (beat - 64) * spb);
    ctx.drawImage(tintCloser, 0, H - 760);                // printed screen: the black is ink on stock, not an empty frame
    printGrain(ctx, { kind: 'ink', alpha: 0.6, seed: 2, frame });
    finish.apply(ctx, frame, { grain: 0.06, vignette: 0.6 }); ctx.restore(); return;
  }
  const s = Math.floor(beat / 8), a = beat - s * 8;
  tm('seg', () => SEGS[s][0](ctx, a, t, frame, beat));
  ctx.restore();
  const cut = a < 0.3 ? 1 - a / 0.3 : 0;            // cut: a short slice-glitch across the first frames of each segment
  if (cut > 0 && s > 0) sliceGlitch(ctx, cut * 0.7, frame * 13, 8);
  tm('finish', () => finish.apply(ctx, frame, { grain: s === 4 ? 0.04 : 0.09, vignette: s === 4 ? 0.3 : 0.7, flash: B.env('impact', t, 14) * 0.5 }));
  ctx.getImageData(0, 0, 1, 1);   // flush the 2D pipeline so the timing is real
  console.log(`ms seg${s} beat=${beat.toFixed(2)} ${(performance.now() - t0).toFixed(0)} read=${window.readability(t).toFixed(2)}`);
};

// bake every lazy cache now, so --from renders and full renders start identically and fast
T3.root.visible = true;
await prewarm({
  looks: [...S1look.map((l, k) => [l, S1[k]]), ...S4look.map((l, k) => [l, S4[k]]), [KO, S2], [ECHO2, S2], [KO5, [...S5, S5many]], [OUT5, [...S5, S5many]], [GHOST5[0], S5many], [GHOST5[1], S5many], [LIVE6, [...S6, ...S6stack]]],
  shatters: S3sh.map(sh => [sh, ['#ff6a3a']]),
  type3d: [T3],
  heat: [[heat, { field: FIELD.pour }]],
  also: () => finish.warm([[0.09, 0.7], [0.04, 0.3], [0.06, 0.6]]),
  frames: { render: t => window.renderFrame(t), at: [0.5, 8.6, 17, 26, 33, 41, 45, 49, 57, 65].map(b => b * spb) },
});
T3.root.visible = false;
window.sceneReady = true;
