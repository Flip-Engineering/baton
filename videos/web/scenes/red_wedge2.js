// RED WEDGE (c20 rework of v14): a forged steel wedge (the JOIN ACP slash bar, 60°) driven on the beat through a timber, a
// marble slab, a university facade printed as an engraving, and the granite cornerstone of 1994, lit from behind by the pour,
// while HAZ'S STALIN SENTENCE, THE CLIENT'S DAYCARE JAB, THE EXPERTS' NAFTA RECORD and CL71 are read in the sources' own words,
// carded at their clauses and breaths. Picture cuts on the blows; a card holds a whole clause (its lines arrive on the blows)
// and is never cut, cracked or masked. The drop is Steel: Man's Servant (1938, US Steel's own film, PD) baked to four-ink
// silkscreen, with the institution's things (empty gilt frames, a mortarboard) breaking and going into the pour between the
// workers. No figures for the experts. OURS is type, three times, each earned; the emblem's light carries the payoff into the
// closer while the open A rings.
// 150 BPM, 88 beats, ☭≡/acc closer at b88 out of the payoff's light.
// Takes (c20): globalThis.ACP_RW_TAKE = 'a' (red_wedge2_a.js), 'b' (the Chairman says the record; red_wedge2_b.js, review only
// until his lines are cleared), 'c' (the cornerstone opens early onto the workers under CL71; red_wedge2_c.js).
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, line, Finish, outCanvas,
  seq, BRAND, tinted, sigil, acpEmblem } from '../lib/kit.js';
import { noise3, crack, drawCrack, drawSparks, drawPuffs } from '../lib/fx/physics.js';
import { TAU, tintC, mk, fbm, pixels, mix3, word, put, halftone, silkscreen, paperOver, PAPER, SPECK } from './red_wedge2.ink.js';

// ================================================================ EVERY WORD (one table; nothing else puts words on screen)
// Script of record: research/scripts_final/red_wedge.json. [beat, length in beats, lines]. '/' breaks a line, '*' marks the
// source's own capitals (AGAINST, FALSE), a leading '~' sets a line small (the verse's citation, the credit), a leading '!' sets
// OURS large. A line that starts '@<beat> ' arrives on that beat (a blow): the card is the whole clause, laid out from its
// first frame so nothing jumps, and its lines come in where the voice would say them. Cards break where a voice breathes.
const TAKE = globalThis.ACP_RW_TAKE || null;
const CUES_PUB = [
  [0, 2, 'STALIN MEANS:'], [2, 5, 'TO BUILD/@4 *AGAINST* THE GRAIN:'],
  [7, 3.5, 'TO DEFY/@8.5 ALL THE ODDS'], [10.5, 4.5, 'IMPOSED BY/@12 APPARENT WORLD ORDER'], [15, 3, 'AND ITS/*FALSE* COSMOS.'],
  [18, 3, 'MOST WESTERN/UNIVERSITIES'], [21, 5.5, 'ARE FOUR YEAR/@23.5 ADULT DAYCARE/@23.5 PROGRAMS,'], [26.5, 3.5, 'EVEN THE/PRESTIGIOUS ONES.'],
  [30, 5, 'THE EXPERTS GAVE US/@33 NAFTA.'], [35, 2.5, 'THE EXPERTS GAVE US/NEOLIBERALISM.'], [37.5, 3, 'THEY GAVE US/DEINDUSTRIALIZATION.'],
  [40.5, 6.5, 'YE SHALL KNOW THEM/@43.5 BY THEIR FRUITS./@43.5 ~MATTHEW 7:16'],
  [48, 4, 'HUMILIATION/@50 OF "EXPERTS,"'], [52, 4, 'GATEKEEPERS,/@54 FALSE ELITES,'], [56, 6, 'AND GLORY/@58 FOR COMMON MAN.'],
  [62, 3, 'BUILD,/@63.5 CULTIVATE,'], [65, 5, 'AND WATCH/@67 THE ENEMY SQUIRM!'],
  [70, 1, '!OURS.'], [71, 1, '!OURS.'],
  [72, 7, 'A WORKING CLASS/@74 THAT IS THE MASTER/@77 OF ALL THINGS'], [79, 5, 'AND THE MOTOR/@81 OF HISTORY.'],
];
// take b (VOICE c5 placement, review only): the Chairman's own sentence carries the record (songs2/red_wedge_e.py VOX_AT; his
// "The" at 11.74 s, in the laugh's breath, so NAFTA and NEOLIBERALISM fall between the blows); the type gives only his title,
// then the verse. The blows and the cuts stay as published.
const VOX = TAKE === 'b' ? 'wx6' : null;
const VOX_CUES = { wx6: [[30, 4, '~EXECUTIVE CHAIRMAN,/~AMERICAN COMMUNIST PARTY']] };
const CUES = (VOX ? CUES_PUB.filter(([s]) => s < 30 || s >= 40.5).concat(VOX_CUES[VOX]).sort((a, b) => a[0] - b[0]) : CUES_PUB)
  .map(([s, d, t, y]) => ({ s, e: s + d, t, y }));
// picture text (carved, engraved, cast; never voiced)
const PIC = {
  crest: 'LVX · ORDO · DOCTRINA', frieze: 'DEAD LEGAL FORMALISM', plaque: ['A WORLD-CLASS', 'INTELLECT'],
  plaqueSmall: 'FOR SERVICE TO NAFTA · 1994', stone: ['ANNO DOMINI', 'MCMXCIV'],
};

// ================================================================ setup
const ctx = outCanvas();
await loadFonts();
const B = await loadBeats(globalThis.ACP_RW_SCENE || 'red_wedge2');
const SPB = B.spb;
const seqImgs = async (n, k) => Promise.all(Array.from({ length: k }, (_, i) => loadImage(`../assets/src/rw/${n}_${String(i).padStart(2, '0')}.jpg`)));
const FOOT = { face: await seqImgs('face', 18), rake: await seqImgs('rake', 41), pour: await seqImgs('pour', 29) };   // Steel: Man's Servant (1938), four-ink silkscreen (scripts/rw_footage_bake.py)
const finish = new Finish(17);
const RED = '#d4101c', INK = '#140606', CREAM = C.cream;
const bt = x => x * SPB;

// ================================================================ the slash: every split runs along the poster's 60° bar
const SA = Math.PI * 2 / 3;                                      // tip direction: down-left, 60° off horizontal
const SX = Math.cos(SA), SY = Math.sin(SA), NX = -SY, NY = SX;   // along the slash / across it

// ---------------------------------------------------------------- materials (texture space = world + margin)
const TW = 1300, TH = 2200, TOX = -110, TOY = -140;
const KNOTS = [[520, 900, 60], [-240, 1500, 44], [300, 2100, 52]];
const WOOD = pixels(TW, TH, (x, y) => {
  const u = -x * NX - y * NY, v = x * SX + y * SY;
  let warp = 95 * fbm(u * 0.0025, v * 0.0008, 0.3, 3), knot = 0;
  for (const [ku, kv, r] of KNOTS) {
    const du = u - ku, dv = (v - kv) / 3.2;
    warp += Math.sign(du) * 38 * Math.exp(-(du * du + dv * dv) / (r * r) * 0.6);
    knot = Math.max(knot, clamp(1 - Math.hypot(du, (v - kv) / 1.6) / r));
  }
  const ring = (u + warp) * 0.028 + 2.2 * fbm(u * 0.006, v * 0.0015, 3.1, 2);
  const f = ring - Math.floor(ring), late = Math.pow(f, 4);
  const fiber = noise3(u * 0.6, v * 0.012, 7) * 0.08 + noise3(u * 0.15, v * 0.004, 9) * 0.07;
  const weather = fbm(x * 0.004, y * 0.004, 12, 3) * 0.18;         // sun-greyed, handled timber, not a fresh board
  let c = mix3(mix3([204, 156, 104], [132, 82, 44], 0.2 + 0.8 * late), [70, 38, 20], knot * knot);
  c = mix3(c, [150, 140, 128], clamp(weather + 0.12));
  const k = 1 + fiber; return [c[0] * k, c[1] * k, c[2] * k];
});
// Calacatta, the institution's stone: a warm white ground with soft grey clouding, and veins that wander and fork (domain-warped
// ridges, not parallel bands), dark at the core with a gilt-grey halo; a polished sheen runs across it diagonally
const MARBLE = pixels(TW, TH, (x, y) => {
  const wx = x + 260 * fbm(x * 0.0021, y * 0.0021, 2.7, 4), wy = y + 260 * fbm(x * 0.0021 + 9, y * 0.0021, 6.1, 4);
  const r1 = 1 - Math.abs(noise3(wx * 0.0017, wy * 0.0011, 1.3));                 // the main veins: long, wandering
  const r2 = 1 - Math.abs(noise3(wx * 0.0052, wy * 0.0047, 4.4));                 // the hair veins that fork off them
  const core = Math.pow(r1, 90), halo = Math.pow(r1, 14), hair = Math.pow(r2, 120) * clamp(0.3 + halo * 1.6);
  const cloud = fbm(x * 0.0013, y * 0.0013, 8, 4), spot = Math.max(0, noise3(x * 0.03, y * 0.03, 12)) * 0.05;
  let c = mix3([246, 242, 234], [214, 208, 200], clamp(0.45 + cloud * 1.4));
  c = mix3(c, [176, 150, 112], clamp(halo * 0.45));                               // the gilt halo round a vein
  c = mix3(c, [58, 54, 60], clamp(core * 0.95 + hair * 0.7));                     // the vein itself
  const sheen = Math.exp(-Math.pow((x * 0.6 + y * 0.8 - 1500) / 260, 2)) * 0.12;  // the polish
  const k = 1 + sheen - spot; return [c[0] * k, c[1] * k, c[2] * k];
});
const GRANITE = pixels(TW, TH, (x, y) => {
  const n = noise3(x * 0.9, y * 0.9, 2), m = noise3(x * 0.05, y * 0.05, 5) * 0.5 + fbm(x * 0.006, y * 0.006, 1, 2) * 0.4;
  if (n > 0.62) return [30, 27, 28];
  if (n < -0.7) return [176, 168, 160];
  if (n > 0.45) return [120, 92, 86];
  return [78 + m * 36, 72 + m * 34, 72 + m * 32];
});
{ // the foundation stone's own inscription: V-cut, the way a cornerstone is
  const g = GRANITE.getContext('2d');
  g.strokeStyle = 'rgba(10,8,8,0.8)'; g.lineWidth = 8; g.strokeRect(250 - TOX, 330 - TOY, 580, 330);
  g.strokeStyle = 'rgba(255,240,220,0.25)'; g.lineWidth = 3; g.strokeRect(255 - TOX, 336 - TOY, 580, 330);
  put(g, word(PIC.stone[0], 'carve', 64, { lip: '#b8aca4', floor: '#0e0c0c' }), 540 - TOX, 430 - TOY);
  put(g, word(PIC.stone[1], 'carve', 110, { lip: '#b8aca4', floor: '#0e0c0c', track: 0.1 }), 540 - TOX, 565 - TOY);
}
const STEEL = pixels(512, 512, (x, y) => {                          // forge scale for the wedge and the sledge
  const n = fbm(x * 0.03, y * 0.03, 4, 3) * 0.5 + noise3(x * 0.4, y * 0.4, 6) * 0.2; const v = 70 + n * 70;
  return [v, v * 0.96, v * 0.94];
});

// ================================================================ the strike worlds: a plate that the wedge splits
// Each world: the material ends at a straight edge through the entry E (square to the slash); behind it, the ground.
// The call for that world is put into the material, so the split carries its letters apart.
function buildPlate(Wd, wordSpec) {
  return mk(TW, TH, g => {
    g.translate(-TOX, -TOY);
    g.fillStyle = Wd.ground; g.fillRect(TOX, TOY, TW, TH);
    if (Wd.groundFx) Wd.groundFx(g);
    const [ex, ey] = Wd.E, back = 60;
    const edge = (o = 0) => { g.beginPath(); g.moveTo(ex - NX * 3000 - SX * o, ey - NY * 3000 - SY * o); g.lineTo(ex + NX * 3000 - SX * o, ey + NY * 3000 - SY * o);
      g.lineTo(ex + NX * 3000 + SX * 4000, ey + NY * 3000 + SY * 4000); g.lineTo(ex - NX * 3000 + SX * 4000, ey - NY * 3000 + SY * 4000); g.closePath(); };
    g.save(); g.fillStyle = 'rgba(0,0,0,0.55)'; g.filter = 'blur(26px)'; g.translate(28, 40); edge(Wd.face + 20); g.fill(); g.restore();   // the block's shadow
    g.save(); edge(Wd.face); g.fillStyle = Wd.faceCol; g.fill(); g.restore();                                                    // the end face, in perspective
    g.save(); edge(); g.clip(); g.drawImage(Wd.tex, TOX, TOY);
    const lg = g.createLinearGradient(ex, ey, ex + SX * 1600, ey + SY * 1600);                                                    // raking light off the edge
    lg.addColorStop(0, 'rgba(255,230,190,0.18)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = lg; g.fillRect(TOX, TOY, TW, TH);
    if (Wd.decor) Wd.decor(g);
    if (Wd.dim) { g.fillStyle = `rgba(14,6,6,${Wd.dim})`; g.fillRect(TOX, TOY, TW, TH); }      // the cornerstone in shadow, so the light behind it reads
    if (wordSpec) put(g, word(wordSpec.text, wordSpec.style, wordSpec.size, wordSpec.o || {}), wordSpec.x, wordSpec.y, { rot: wordSpec.rot || 0, op: wordSpec.op, maxW: wordSpec.maxW || 860 });
    g.restore();
    g.strokeStyle = Wd.lip; g.lineWidth = 4; g.beginPath(); g.moveTo(ex - NX * 3000, ey - NY * 3000); g.lineTo(ex + NX * 3000, ey + NY * 3000); g.stroke();
  });
}
const plates = new Map();
function plateFor(Wd, b) {
  const w = null;
  const key = Wd.name + '|' + (w ? w.text + w.x : '');
  if (!plates.has(key)) plates.set(key, buildPlate(Wd, w));
  return plates.get(key);
}
function blowState(blows, b) {
  let n = 0, last = -1e9, next = 1e9;
  for (const x of blows) { if (x <= b + 1e-4) { n++; last = x; } else next = Math.min(next, x); }
  return { n, age: (b - last) * SPB, to: (next - b) * SPB };
}
const landed = S => Math.max(0, S.n - 1 + ease.outExpo(S.age / 0.12));
function splitPath(seed, len = 2600, step = 22) {
  const r = rng(seed), pts = []; let off = 0;
  for (let d = 0; d <= len; d += step) { off = off * 0.62 + (r() - 0.5) * 14; pts.push([d, off]); }
  return pts;
}
function branches(seed, n, reach = 2000) {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const d = 120 + r() * reach, side = r() < 0.5 ? -1 : 1;
    out.push({ d, segs: crack(0, 0, { seed: seed * 10 + i, angle: SA + side * (0.25 + r() * 0.35), len: 160 + r() * 240, gens: 3, spread: 0.4 }) });
  }
  return out;
}
const WL = 640, WS = 1.0;                                                 // the wedge: 640 long, 118 across the head
const whw = u => u < 36 ? 2 + u * 0.06 : u < WL - 60 ? lerp(4, 50, (u - 36) / (WL - 96)) : 50;   // half-width at u from the tip
// the halves of the plate hinge about the crack's far end, pushed apart by exactly the wedge at the entry
function strikeScene(Wd, b, t) {
  const S = blowState(Wd.blows, b), nf = landed(S);
  const depth = Wd.depth0 + Wd.dStep * nf, front = Wd.front0 + Wd.fStep * nf, total = depth + front;
  const [ex, ey] = Wd.E, PL = plateFor(Wd, b);
  const px = ex + SX * total, py = ey + SY * total;
  const th = (whw(depth) * WS + Wd.open0 + Wd.oStep * nf) / total;
  fill(Wd.ground);                                              // past the plate's edge (wide or canted framings): the ground, never black
  ctx.drawImage(PL, TOX, TOY);                                  // beyond the crack's end: whole
  const pts = Wd.path.filter(p => p[0] <= total).map(([d, o]) => [ex + SX * d + NX * o, ey + SY * d + NY * o]);
  pts.push([px, py]);
  const rot = (p, a) => { const c = Math.cos(a), s = Math.sin(a), dx = p[0] - px, dy = p[1] - py; return [px + dx * c - dy * s, py + dx * s + dy * c]; };
  // the gap: the dark inside of the split (hot in the granite)
  ctx.save(); ctx.beginPath();
  pts.forEach((p, i) => { const q = rot(p, -th); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
  for (let i = pts.length - 1; i >= 0; i--) { const q = rot(pts[i], th); ctx.lineTo(q[0], q[1]); }
  ctx.closePath();
  if (Wd.glow) {                                                // behind the stone: the furnace (the pour, from the film), brighter every blow
    ctx.clip(); const A = FOOT.pour, fi = clamp(Math.floor(6 + t * 12) % A.length, 0, A.length - 1);
    ctx.drawImage(A[fi], TOX, TOY, TW, TH);
    ctx.globalCompositeOperation = 'lighter'; const hot = clamp(0.25 + 0.1 * nf + 0.5 * Math.exp(-S.age * 5));
    const rg = ctx.createRadialGradient(ex, ey, 20, ex, ey, 1400); rg.addColorStop(0, `rgba(255,170,80,${hot})`); rg.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = rg; ctx.fillRect(TOX, TOY, TW, TH); ctx.restore();
  } else {
    const gg = ctx.createLinearGradient(ex, ey, px, py);
    gg.addColorStop(0, '#1a0a06'); gg.addColorStop(0.5, '#060202'); gg.addColorStop(1, '#030101');
    ctx.fillStyle = gg; ctx.fill(); ctx.restore();
  }
  wedge(ex, ey, depth, S, Wd);
  for (const side of [-1, 1]) {                                 // each half: the material between the edge and the hinge, on its side of the path
    ctx.save();
    ctx.translate(px, py); ctx.rotate(side * th); ctx.translate(-px, -py);
    ctx.beginPath();
    const far = 3000, [fx0, fy0] = [ex + NX * far * side, ey + NY * far * side];
    ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(px + NX * far * side, py + NY * far * side); ctx.lineTo(fx0, fy0); ctx.closePath(); ctx.clip();
    ctx.drawImage(PL, TOX, TOY);
    ctx.strokeStyle = Wd.lip; ctx.lineWidth = 3; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    ctx.restore();
  }
  if (Wd.glow) {                                                // the light through the split spills onto the faces of the stone
    const breath = Wd.breath && b >= Wd.breath ? ease.inCubic(clamp((b - Wd.breath) / 0.5)) : 0;
    const lw = 10 + 7 * nf + 40 * breath, la = clamp(0.35 + 0.08 * nf + 0.5 * Math.exp(-S.age * 6) + 0.4 * breath);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [bl, wk, col] of [[30, 3, `rgba(255,110,30,${la * 0.7})`], [8, 1.2, `rgba(255,190,110,${la})`]]) {
      ctx.filter = `blur(${bl}px)`; ctx.strokeStyle = col; ctx.lineWidth = lw * wk; ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    }
    ctx.restore();
  }
  for (const br of Wd.branches) {
    if (br.d > total - 40) continue;
    ctx.save(); ctx.translate(ex + SX * br.d, ey + SY * br.d);
    const grow = clamp((total - br.d) / 420);
    if (Wd.glow) {                                              // every new crack is lit from behind: the furnace shows through it
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(10px)';
      drawCrack(ctx, br.segs, { grow, width: 6 + 2 * nf, dark: 'rgba(255,120,40,0.8)', lip: 'rgba(0,0,0,0)' }); ctx.restore();
      drawCrack(ctx, br.segs, { grow, width: 4 + nf * 0.8, dark: '#ffd28a', lip: 'rgba(20,6,6,0.7)', lipOff: [2, 2] });
    } else drawCrack(ctx, br.segs, { grow, width: 5, dark: Wd.crackDark || 'rgba(8,2,2,0.9)' });
    ctx.restore();
  }
  const hits = Wd.blows.filter(x => x <= b + 1e-4).slice(-3).map(x => ({ t: bt(x), x: ex - SX * 40, y: ey - SY * 40, e: 900 }));
  chips(hits, t, Wd.chips, Wd.chipShape);
  drawSparks(ctx, hits, t, { n: 12, speed: 1200, life: 0.4, color: '#ffb050' });
  hammer(ex - SX * (WL - depth), ey - SY * (WL - depth), S);
}
function chips(hits, t, col, shape = 'splinter') {
  for (const h of hits) {
    const age = t - h.t; if (age < 0 || age > 0.8) continue;
    const r = rng((h.t * 1000) | 0);
    for (let i = 0; i < 18; i++) {
      const a = SA + Math.PI + (r() - 0.5) * 2.4, s = 500 + r() * 1000, vx = Math.cos(a) * s, vy = Math.sin(a) * s;
      const x = h.x + vx * age, y = h.y + vy * age + 1500 * age * age, rot = r() * 6, sp = (r() - 0.5) * 30;
      const w = shape === 'splinter' ? 16 + r() * 50 : 6 + r() * 22, hh = shape === 'splinter' ? 3 + r() * 5 : 4 + r() * 16;
      ctx.save(); ctx.globalAlpha = clamp(1 - age / 0.8); ctx.translate(x, y); ctx.rotate(rot + age * sp);
      ctx.fillStyle = i % 3 ? col : '#1a0c06';
      if (shape === 'splinter') { ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(0, -hh / 2); ctx.lineTo(w / 2, 0); ctx.lineTo(0, hh / 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(-w / 2, -hh / 3); ctx.lineTo(w / 3, -hh / 2); ctx.lineTo(w / 2, hh / 3); ctx.lineTo(-w / 4, hh / 2); ctx.fill(); }
      ctx.restore();
    }
  }
}
// ---------------------------------------------------------------- the forged wedge: long taper, mushroomed head, chipped red enamel
const WEDGE = mk(WL + 40, 150, g => {
  const cy = 75, L = WL, P = new Path2D();                     // drawn tip at x = L+10, head at x = 10
  P.moveTo(L + 10, cy - 2);
  for (let u = 0; u <= L - 60; u += 8) P.lineTo(L + 10 - u, cy - whw(u));
  P.lineTo(70, cy - 50); P.lineTo(28, cy - 52); P.lineTo(20, cy - 61); P.lineTo(14, cy - 54); P.lineTo(8, cy - 57);   // a square head, burred by the blows
  P.lineTo(8, cy + 57); P.lineTo(13, cy + 62); P.lineTo(19, cy + 53); P.lineTo(30, cy + 55); P.lineTo(70, cy + 50);
  for (let u = L - 60; u >= 0; u -= 8) P.lineTo(L + 10 - u, cy + whw(u));
  P.closePath();
  g.save(); g.clip(P);
  const sg = g.createLinearGradient(0, cy - 60, 0, cy + 60);   // a forged bar: bright ridge above centre, dark flanks
  sg.addColorStop(0, '#5a5454'); sg.addColorStop(0.47, '#8a8482'); sg.addColorStop(0.5, '#e8e4de'); sg.addColorStop(0.53, '#3a3434'); sg.addColorStop(1, '#1a1616');
  g.fillStyle = sg; g.fillRect(0, 0, L + 40, 150);
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.45; g.drawImage(STEEL, 0, 0, L + 40, 150); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const paint = mk(L + 40, 150, p => {                          // the red enamel over the body, worn off the head and the ground edge
    p.fillStyle = '#b0101a'; p.fillRect(34, 0, L - 90, 150);
    const id = p.getImageData(0, 0, L + 40, 150), d = id.data;
    for (let y = 0; y < 150; y++) for (let x = 0; x < L + 40; x++) {
      const i = (y * (L + 40) + x) * 4; if (!d[i + 3]) continue;
      const edge = Math.min(x - 34, L - 56 - x) / 50, n = noise3(x * 0.05, y * 0.05, 3) + noise3(x * 0.2, y * 0.2, 5) * 0.4;
      if (n + edge * 0.6 < 0.15 || Math.abs(y - cy) > 46 - n * 10) d[i + 3] = 0;
    }
    p.putImageData(id, 0, 0);
    p.globalCompositeOperation = 'destination-out'; p.strokeStyle = '#000'; p.lineWidth = 1.5; const sr = rng(12);
    for (let i = 0; i < 40; i++) { const x = 40 + sr() * (L - 120), y = cy + (sr() - 0.5) * 80; p.beginPath(); p.moveTo(x, y); p.lineTo(x + 20 + sr() * 90, y + (sr() - 0.5) * 6); p.stroke(); }   // scratches to bare steel
    p.globalCompositeOperation = 'source-atop'; const pg = p.createLinearGradient(0, cy - 50, 0, cy + 50);
    pg.addColorStop(0, 'rgba(255,170,150,0.18)'); pg.addColorStop(0.49, 'rgba(255,200,180,0.32)'); pg.addColorStop(0.5, 'rgba(255,235,220,0.8)'); pg.addColorStop(0.52, 'rgba(0,0,0,0.45)'); pg.addColorStop(1, 'rgba(0,0,0,0.6)');
    p.fillStyle = pg; p.fillRect(0, 0, L + 40, 150);
  });
  g.drawImage(paint, 0, 0);
  g.fillStyle = 'rgba(255,245,230,0.35)'; g.fillRect(8, 0, 4, 150);                         // the struck face, polished by the blows
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
  for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(L - 110 + k * 16, cy - 2); g.lineTo(L + 10, cy - 2); g.stroke(); }   // ground bevel
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.stroke(P);
});
function wedge(ex, ey, depth, S, Wd = {}) {
  const tipX = ex + SX * depth, tipY = ey + SY * depth;
  const jolt = S.age < 0.15 ? Math.sin(S.age * 120) * 5 * (1 - S.age / 0.15) : 0;
  ctx.save(); ctx.translate(tipX + NX * jolt, tipY + NY * jolt); ctx.rotate(SA);
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24; ctx.shadowOffsetX = 18; ctx.shadowOffsetY = 26;
  ctx.scale(1, WS); ctx.drawImage(WEDGE, -WL - 10, -75); ctx.shadowColor = 'transparent';
  const hot = Math.exp(-S.age * 7);
  if (hot > 0.02) { ctx.globalCompositeOperation = 'lighter'; const hg = ctx.createRadialGradient(-WL, 0, 0, -WL, 0, 90); hg.addColorStop(0, `rgba(255,200,130,${0.9 * hot})`); hg.addColorStop(1, 'rgba(255,90,20,0)'); ctx.fillStyle = hg; ctx.fillRect(-WL - 100, -100, 200, 200); }
  ctx.restore();
}
// ---------------------------------------------------------------- the sledge: hickory handle and forged head, swung from out of frame (no hand)
const HL = 1800, IMP = SA - Math.PI / 2;                 // a long reach: the swing comes from out of frame, the hands never shown
function hammerAngle(S) {
  const up = IMP - 1.25;
  if (S.to < 0.14) return lerp(up, IMP, ease.inCubic(1 - S.to / 0.14));
  if (S.age < 0.05) return IMP;
  return lerp(IMP, up, ease.inOutCubic((S.age - 0.05) / 0.45));
}
const HANDLE = mk(HL + 20, 60, g => {
  const hg = g.createLinearGradient(0, 6, 0, 54); hg.addColorStop(0, '#e2bd88'); hg.addColorStop(0.45, '#b07c44'); hg.addColorStop(1, '#4a2c12');
  g.fillStyle = hg; g.beginPath(); g.moveTo(0, 6); g.quadraticCurveTo(HL * 0.5, 12, HL, 16); g.lineTo(HL, 44); g.quadraticCurveTo(HL * 0.5, 48, 0, 54); g.closePath(); g.fill();
  g.save(); g.clip(); g.strokeStyle = 'rgba(70,36,12,0.35)'; g.lineWidth = 1.5; const r = rng(3);
  for (let i = 0; i < 16; i++) { const y = 10 + r() * 40; g.beginPath(); g.moveTo(0, y); for (let x = 0; x < HL; x += 40) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 3); g.stroke(); }
  g.fillStyle = 'rgba(30,16,8,0.35)'; g.fillRect(40, 0, 220, 60);                          // the grip, dark with use
  g.restore();
});
const HEAD = mk(180, 320, g => {
  const P = new Path2D(); P.moveTo(18, 10); P.lineTo(162, 10); P.lineTo(176, 34); P.lineTo(176, 286); P.lineTo(162, 310); P.lineTo(18, 310); P.lineTo(4, 286); P.lineTo(4, 34); P.closePath();
  g.save(); g.clip(P);
  const sg = g.createLinearGradient(0, 0, 180, 0); sg.addColorStop(0, '#6e6a68'); sg.addColorStop(0.25, '#2a2626'); sg.addColorStop(0.7, '#141212'); sg.addColorStop(1, '#383232');
  g.fillStyle = sg; g.fillRect(0, 0, 180, 320);
  g.globalCompositeOperation = 'multiply'; g.drawImage(STEEL, 0, 0, 180, 320); g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(255,240,225,0.6)'; g.fillRect(4, 298, 172, 12); g.fillRect(4, 10, 172, 10);          // the two faces' bright rims
  g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(22, 30, 16, 260);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(66, 140, 48, 40);                                            // the eye wedge
  g.restore();
});
function hammer(hx, hy, S) {
  const cxh = hx - SX * 140, cyh = hy - SY * 140;
  const px = cxh - Math.cos(IMP) * HL, py = cyh - Math.sin(IMP) * HL;
  const th = hammerAngle(S);
  const draw = (a, alpha) => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(px, py); ctx.rotate(a);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetX = 30; ctx.shadowOffsetY = 40;
    ctx.drawImage(HANDLE, 0, -30); ctx.drawImage(HEAD, HL - 90, -160);
    ctx.shadowColor = 'transparent';
    ctx.restore();
  };
  if (S.to < 0.14) for (let k = 3; k >= 1; k--) draw(th - k * 0.09, 0.12);
  draw(th, 1);
}

// ---------------------------------------------------------------- worlds
const DIRT = pixels(650, 1100, (x, y) => { const n = fbm(x * 0.02, y * 0.02, 5, 4) * 0.6 + noise3(x * 0.5, y * 0.5, 6) * 0.25; const v = 1 + n; return [70 * v, 46 * v, 30 * v]; });
const woodGround = g => {                                      // the chopping yard: packed dirt, sawdust, chips, low sun from the top right
  g.drawImage(DIRT, TOX, TOY, TW, TH);
  const sun = g.createRadialGradient(1000, 100, 50, 900, 300, 1400); sun.addColorStop(0, 'rgba(255,170,90,0.35)'); sun.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = sun; g.fillRect(TOX, TOY, TW, TH);
  const r = rng(8);
  for (let i = 0; i < 700; i++) { g.fillStyle = r() < 0.5 ? 'rgba(200,150,90,0.25)' : 'rgba(0,0,0,0.3)'; g.save(); g.translate(TOX + r() * TW, TOY + r() * TH); g.rotate(r() * 6); g.fillRect(0, 0, 6 + r() * 40, 2 + r() * 6); g.restore(); }
};
const W_WOOD = { name: 'wood', tex: WOOD, E: [760, 520], blows: [0, 2, 4, 5.5, 7], depth0: 220, dStep: 44, front0: 300, fStep: 190, open0: 10, oStep: 30,
  path: splitPath(3), branches: branches(4, 9, 1500), chips: '#d6a468', ground: '#34221a', groundFx: woodGround, face: 46, faceCol: '#7a4a24',
  lip: 'rgba(255,226,180,0.45)',
  words: [] };
const W_MARBLE = { name: 'marble', tex: MARBLE, E: [780, 500], blows: [9, 10.5, 12, 13.5], depth0: 160, dStep: 60, front0: 420, fStep: 300, open0: 8, oStep: 22,
  path: splitPath(9), branches: branches(11, 12, 1500), chips: '#eee8de', chipShape: 'flake', ground: '#1a0608', face: 38, faceCol: '#a8a09a',
  lip: 'rgba(255,255,255,0.8)', crackDark: 'rgba(40,36,40,0.85)',
  words: [] };
const W_STONE = { name: 'stone', tex: GRANITE, E: [760, 460], blows: [72, 74.5, 77, 79, 81, 83], depth0: 260, dStep: 30, front0: 420, fStep: 230, open0: 12, oStep: 16,
  path: splitPath(21), branches: branches(22, 14, 1700), chips: '#9a908a', chipShape: 'flake', glow: true, lip: 'rgba(255,170,110,0.9)',
  ground: '#120404', face: 54, faceCol: '#3a3232', dim: 0.42, breath: 83.5,
  words: [] };

// ================================================================ camera
function cam(c, b, b0, draw) {
  const [cx, cy, z, rot, dz = 0.05, shk = 0] = c;
  const age = (b - b0) * SPB, kick = B.env('kick', bt(b), 12);
  const zz = z * (1 + dz * age) * (1 + 0.025 * kick), sh = B.env('hammer', bt(b), 14) * (14 + shk) + Math.max(0, B.env('kick', bt(b), 8)) * shk * 0.4;
  ctx.save();
  ctx.translate(W / 2 + Math.sin(b * 57) * sh, H / 2 + Math.cos(b * 43) * sh); ctx.rotate(rot); ctx.scale(zz, zz); ctx.translate(-cx, -cy);
  draw(); ctx.restore();
}
const fill = col => { ctx.fillStyle = col; ctx.fillRect(-3000, -3000, W + 6000, H + 6000); };

// ---------------------------------------------------------------- ADULT DAYCARE: sprayed across the crest on the marble; the crest splits
const CREST_CRACK = crack(540, 330, { seed: 31, angle: Math.PI / 2 + 0.12, len: 1300, gens: 4, spread: 0.45, jitter: 0.25 });
const CREST = mk(W, H, g => {
  g.drawImage(MARBLE, TOX, TOY);
  g.translate(540, 820);
  const sh = () => { g.beginPath(); g.moveTo(-260, -300); g.lineTo(260, -300); g.lineTo(260, 20); g.quadraticCurveTo(250, 250, 0, 360); g.quadraticCurveTo(-250, 250, -260, 20); g.closePath(); };
  g.fillStyle = 'rgba(40,30,34,0.18)'; g.save(); g.translate(8, 10); sh(); g.fill(); g.restore();
  g.lineWidth = 18; g.strokeStyle = 'rgba(110,100,102,0.75)'; sh(); g.stroke();
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.save(); g.translate(-4, -4); sh(); g.stroke(); g.restore();
  g.fillStyle = 'rgba(90,80,86,0.55)';
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, -120); g.quadraticCurveTo(s * 90, -160, s * 190, -120); g.lineTo(s * 190, 60); g.quadraticCurveTo(s * 90, 20, 0, 60); g.closePath(); g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3;
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-170, -80 + i * 28); g.lineTo(-30, -72 + i * 28); g.moveTo(30, -72 + i * 28); g.lineTo(170, -80 + i * 28); g.stroke(); }
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) {
    const a = Math.PI / 2 + s * (0.3 + i * 0.2), x = Math.cos(a) * 330, y = 60 + Math.sin(a) * 300;
    g.save(); g.translate(x, y); g.rotate(a + s * 1.2); g.fillStyle = 'rgba(100,92,96,0.5)'; g.beginPath(); g.ellipse(0, 0, 36, 13, 0, 0, TAU); g.fill(); g.restore();
  }
  put(g, word(PIC.crest, 'carve', 44, { family: 'Archivo Black', track: 0.1 }), 0, 440);
});
function crest(b, t) {
  const S = blowState([15], b), f = S.n ? ease.outExpo(S.age / 0.25) : 0, shift = 30 * f;
  fill('#0a0404');
  for (const s of [-1, 1]) {
    ctx.save(); ctx.beginPath(); s < 0 ? ctx.rect(-400, -400, 940, 2800) : ctx.rect(540, -400, 1000, 2800); ctx.clip();
    ctx.translate(s * shift, -s * shift * 0.3); ctx.rotate(s * 0.012 * f);
    ctx.drawImage(CREST, 0, 0);
    ctx.restore();
  }
  if (f > 0) { drawCrack(ctx, CREST_CRACK, { grow: f, width: 10, dark: 'rgba(30,24,28,0.95)' }); chips([{ t: bt(15), x: 540, y: 500 }], t, '#e8e2d8', 'flake'); }
  hammer(560, 180, blowState([15], b));
}
// ---------------------------------------------------------------- the drop: no figures for the experts. Their things break and go into
// the pour, between the workers: the gallery's gilt frames (empty, as the plaque's wall was), a mortarboard. Printed in the film's
// own four inks (ink, maroon, red, cream, orange) so a cut from a frame to a worker is one print run.
const K = { ink: '#140606', maroon: '#570a0b', red: '#d13420', cream: '#f5e3c2', orange: '#f0a152' };
const GW = 440, GH = 540, GB = 64;                                        // a gilt frame: outer size and moulding width
const GILT = mk(GW, GH, g => {
  const ring = (o, w, col) => { g.fillStyle = col; g.fillRect(o, o, GW - 2 * o, w); g.fillRect(o, GH - o - w, GW - 2 * o, w); g.fillRect(o, o, w, GH - 2 * o); g.fillRect(GW - o - w, o, w, GH - 2 * o); };
  ring(0, GB, K.orange);
  g.fillStyle = K.cream; g.fillRect(6, 6, GW - 12, 10); g.fillRect(6, 6, 10, GH - 12);                       // the lit top and left edges
  g.fillStyle = K.red; g.fillRect(6, GH - 18, GW - 12, 12); g.fillRect(GW - 18, 6, 12, GH - 12);             // the shadowed bottom and right
  ring(GB - 14, 14, K.maroon); ring(GB - 6, 6, K.ink);                                                       // the sight edge
  g.strokeStyle = K.ink; g.lineWidth = 4; g.strokeRect(2, 2, GW - 4, GH - 4); g.strokeRect(24, 24, GW - 48, GH - 48);
  g.fillStyle = K.cream;                                                                                     // the bead run
  for (let x = 40; x < GW - 30; x += 22) { g.beginPath(); g.arc(x, 36, 5, 0, TAU); g.arc(x, GH - 36, 5, 0, TAU); g.fill(); }
  for (let y = 58; y < GH - 50; y += 22) { g.beginPath(); g.arc(36, y, 5, 0, TAU); g.arc(GW - 36, y, 5, 0, TAU); g.fill(); }
  for (const [cx, cy] of [[34, 34], [GW - 34, 34], [34, GH - 34], [GW - 34, GH - 34]]) {                   // the corner leaves
    g.fillStyle = K.cream; g.beginPath(); g.ellipse(cx, cy, 30, 22, Math.PI / 4, 0, TAU); g.fill();
    g.fillStyle = K.red; g.beginPath(); g.ellipse(cx + 4, cy + 4, 14, 9, Math.PI / 4, 0, TAU); g.fill();
  }
  g.fillStyle = K.cream; g.fillRect(GW / 2 - 60, GH - 50, 120, 22); g.fillStyle = K.ink; g.fillRect(GW / 2 - 48, GH - 43, 96, 8);   // the empty name tablet
  g.globalCompositeOperation = 'destination-out'; g.fillRect(GB, GB, GW - 2 * GB, GH - 2 * GB);                  // nothing in it
  g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.35; g.fillStyle = g.createPattern(SPECK, 'repeat'); g.fillRect(0, 0, GW, GH);
});
const GLASS = Array.from({ length: 6 }, (_, k) => Array.from({ length: 6 }, (_, j) => crack(0, 0, { seed: 50 + k * 9 + j, angle: j / 6 * TAU + k, len: 190, gens: 2, spread: 0.35 })));
const HANG = [[290, 360], [790, 360], [290, 830], [790, 830], [290, 1300], [790, 1300]];
// one empty frame: its glass crazed by gf, split along the slash by sep (the halves slide apart across it)
function giltAt(x, y, sc, rot, k, gf = 0, sep = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
  const one = () => {
    ctx.fillStyle = 'rgba(20,6,6,0.55)'; ctx.fillRect(-GW / 2 + 16, -GH / 2 + 22, GW, GH);                     // its shadow on the wall
    ctx.drawImage(GILT, -GW / 2, -GH / 2);
    if (gf > 0) { ctx.save(); ctx.beginPath(); ctx.rect(-GW / 2 + GB, -GH / 2 + GB, GW - 2 * GB, GH - 2 * GB); ctx.clip();
      for (const segs of GLASS[k % 6]) drawCrack(ctx, segs, { grow: gf, width: 3.5, dark: K.cream, lip: 'rgba(20,6,6,0.6)', lipOff: [1, 1] }); ctx.restore(); }
  };
  if (sep <= 0) one();
  else for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(-NX * side * sep, -NY * side * sep); ctx.rotate(side * sep * 0.0008);
    ctx.beginPath(); ctx.moveTo(SX * 2000, SY * 2000); ctx.lineTo(-SX * 2000, -SY * 2000);
    ctx.lineTo(-SX * 2000 + NX * side * 3000, -SY * 2000 + NY * side * 3000); ctx.lineTo(SX * 2000 + NX * side * 3000, SY * 2000 + NY * side * 3000); ctx.closePath(); ctx.clip();
    one(); ctx.restore();
  }
  ctx.restore();
}
// the gallery: a maroon wall, panelled in ink; six empty frames. hit: the blow that crazes them; fallAt: they come off the wall;
// split: [k, beat] one frame takes the wedge and parts along the slash
function gallery(b, t, { hit = 48, fallAt = 1e9, split = null } = {}) {
  fill(K.maroon);
  ctx.fillStyle = K.ink; for (let i = 0; i < 12; i++) ctx.fillRect(-120 + i * 120, -400, 6, H + 800);
  ctx.fillRect(-400, 1600, W + 800, 22); ctx.fillStyle = K.red; ctx.fillRect(-400, 1622, W + 800, 6);
  const S = blowState([hit], b), jolt = S.n && S.age < 0.2 ? Math.sin(S.age * 90) * 8 * (1 - S.age / 0.2) : 0;
  HANG.forEach(([x, y], k) => {
    const late = ((k * 0.37) % 1) * 0.5, fall = ease.inCubic(clamp((b - fallAt - late) / 0.9)), side = x < 540 ? -1 : 1;
    const gf = S.n ? ease.outExpo(clamp((S.age - k * 0.03) / 0.2)) : 0;
    const sp = split && split[0] === k ? 260 * ease.outExpo(clamp((b - split[1]) * SPB / 0.18)) : 0;
    ctx.fillStyle = K.ink; ctx.beginPath(); ctx.arc(x, y - 300, 7, 0, TAU); ctx.fill();                          // the hook
    giltAt(x + side * fall * 160 + jolt, y + fall * 1500, 0.92, side * (0.03 + fall * 0.9) + jolt * 0.003, k, gf, sp);
  });
  if (S.n && S.age < 0.6) drawSparks(ctx, [{ t: bt(hit), x: 540, y: 820, e: 900 }], t, { n: 14, speed: 1300, life: 0.45, color: K.orange });
}
// a mortarboard, as an object (no wearer): the board seen at an angle, the skull cap under it, the tassel swinging
function mortarboard(x, y, sc, rot, t) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.fillStyle = K.ink; ctx.beginPath(); ctx.moveTo(-200, 0); ctx.lineTo(10, -70); ctx.lineTo(210, 4); ctx.lineTo(0, 76); ctx.closePath(); ctx.fill();
  ctx.fillStyle = K.maroon; ctx.beginPath(); ctx.moveTo(-200, 0); ctx.lineTo(0, 76); ctx.lineTo(0, 92); ctx.lineTo(-200, 14); ctx.closePath(); ctx.fill();   // the board's edge
  ctx.fillStyle = K.ink; ctx.beginPath(); ctx.moveTo(-110, 40); ctx.quadraticCurveTo(-120, 150, 0, 160); ctx.quadraticCurveTo(120, 150, 110, 40); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = K.orange; ctx.lineWidth = 7; const sw = Math.sin(t * 7) * 0.4;
  ctx.beginPath(); ctx.moveTo(5, 3); ctx.lineTo(150, 30); ctx.lineTo(150 + Math.sin(sw) * 120, 30 + Math.cos(sw) * 120); ctx.stroke();
  ctx.fillStyle = K.orange; ctx.beginPath(); ctx.ellipse(150 + Math.sin(sw) * 130, 30 + Math.cos(sw) * 130, 12, 26, -sw, 0, TAU); ctx.fill();
  ctx.restore();
}
// into the pour: the film's molten steel (Steel: Man's Servant), and the institution's things dropping into it. Below the surface
// they are gone; at the surface the heat makes them squirm (each strip of the frame shears on its own) and the edge glows.
// things: [{ kind: 'gilt'|'cap', k, x, y0, y1, b0, b1, sc, rot, heat }]: dropping from y0 at b0 to y1 at b1
const SURF = 1240;
function pour(b, t, b0, f0, things = []) {
  const A = FOOT.pour, i = clamp(Math.floor(f0 + (b - b0) * SPB * 12), 0, A.length - 1);
  ctx.drawImage(A[i], 0, 0, W, H);
  for (const th of things) {
    if (b < th.b0) continue;
    const u = clamp((b - th.b0) / (th.b1 - th.b0)), y = lerp(th.y0, th.y1, th.y1 > SURF ? ease.inOutCubic(u) : ease.inCubic(u));
    const heat = clamp(th.heat ?? 1) * clamp((y + 300 - SURF) / 500), rot = th.rot * (1 - u * 0.3);
    ctx.save(); ctx.beginPath(); ctx.rect(-2000, -2000, W + 4000, SURF + 2000 + Math.sin(t * 9) * 6); ctx.clip();
    if (th.kind === 'cap') mortarboard(th.x, y, th.sc, rot + u * 0.8, t);
    else {
      ctx.save(); ctx.translate(th.x, y); ctx.rotate(rot); ctx.scale(th.sc, th.sc);
      for (let sy = 0; sy < GH; sy += 12) {                                                      // the squirm: strips sheared by the heat
        const amp = heat * (8 + 34 * (sy / GH)), dx = Math.sin(t * 11 + sy * 0.045 + th.k) * amp + Math.sin(t * 23 + sy * 0.11) * amp * 0.3;
        ctx.drawImage(GILT, 0, sy, GW, 12, -GW / 2 + dx, -GH / 2 + sy, GW, 12.5);
      }
      ctx.restore();
    }
    ctx.restore();
    if (y + 200 > SURF) {                                                                         // where it meets the steel: the glow
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(18px)';
      const w = (th.kind === 'cap' ? 230 : GW * 0.6) * th.sc;
      const gl = ctx.createLinearGradient(0, SURF - 60, 0, SURF + 30); gl.addColorStop(0, 'rgba(240,161,82,0)'); gl.addColorStop(0.7, 'rgba(255,190,110,0.85)'); gl.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = gl; ctx.fillRect(th.x - w, SURF - 60, w * 2, 90); ctx.restore();
      const hitT = th.b0 + (th.b1 - th.b0) * 0.35;
      drawSparks(ctx, [{ t: bt(hitT), x: th.x, y: SURF, e: 700 }], t, { n: 16, speed: 1100, life: 0.5, color: '#ffc070' });
    }
  }
}
function plaque(b, t, at = 15) {
  ctx.drawImage(MARBLE, TOX, TOY); fill('rgba(0,0,0,0.25)');
  const u = clamp((b - at) / 1.0), fall = ease.inCubic(u);
  ctx.fillStyle = '#1a1414'; for (const [x, yy] of [[250, 610], [830, 610], [250, 1030], [830, 1030]]) { ctx.beginPath(); ctx.arc(x, yy, 10, 0, TAU); ctx.fill(); }
  ctx.save(); ctx.translate(540 + fall * 60, 820 + fall * 1300); ctx.rotate(0.03 + fall * 0.9);
  const g = ctx.createLinearGradient(-320, -230, 320, 230); g.addColorStop(0, '#f0d890'); g.addColorStop(0.45, '#b08a3a'); g.addColorStop(1, '#6a4a18');
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(-300, -200, 620, 440);
  ctx.fillStyle = g; ctx.fillRect(-320, -230, 640, 460);
  ctx.strokeStyle = '#5a3a10'; ctx.lineWidth = 8; ctx.strokeRect(-296, -206, 592, 412);
  line(ctx, PIC.plaque[0], 0, -50, { family: 'Anton', size: 88, color: '#3a2408', maxW: 540 });
  line(ctx, PIC.plaque[1], 0, 70, { family: 'Anton', size: 104, color: '#3a2408', maxW: 540 });
  line(ctx, PIC.plaqueSmall, 0, 160, { family: 'Archivo Black', size: 26, color: '#4a3010', maxW: 520 });
  ctx.restore();
}

// ---------------------------------------------------------------- the facade, printed as a line engraving on cream stock, red sky in a second ink
// tone map first (flat architecture), then a line screen: the engraver's rules swell with the dark, cross-hatch in the deepest
const FACADE_TONE = mk(W, H, g => {
  const stone = (x, y, w, h, a, b2) => { const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, a); gr.addColorStop(1, b2); g.fillStyle = gr; g.fillRect(x, y, w, h); };
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1a1a1a'; g.fillRect(90, 640, 900, 880);                            // the portico's shade
  g.fillStyle = '#383838'; g.fillRect(410, 900, 260, 620);                           // the doors
  for (let i = 0; i < 5; i++) {
    const x = 150 + i * 195;
    stone(x - 62, 700, 124, 800, '#f0f0f0', '#707070');
    for (let k = -3; k <= 3; k++) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + k * 16 - 2, 712, 4, 776); }   // flutes
    stone(x - 86, 650, 172, 50, '#f4f4f4', '#9a9a9a'); stone(x - 76, 690, 152, 18, '#d0d0d0', '#707070'); stone(x - 84, 1480, 168, 40, '#e0e0e0', '#8a8a8a');
  }
  stone(60, 560, 960, 100, '#f2f2f2', '#a0a0a0');
  g.fillStyle = '#d8d8d8'; g.beginPath(); g.moveTo(40, 560); g.lineTo(540, 250); g.lineTo(1040, 560); g.closePath(); g.fill();
  g.fillStyle = '#b0b0b0'; g.beginPath(); g.moveTo(120, 535); g.lineTo(540, 290); g.lineTo(960, 535); g.closePath(); g.fill();
  g.fillStyle = '#808080'; g.beginPath(); g.arc(540, 450, 60, 0, TAU); g.fill();
  for (let i = 0; i < 4; i++) stone(20 - i * 30, 1520 + i * 60, W - 40 + i * 60, 60, '#e8e8e8', '#9a9a9a');
  g.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 4; i++) g.fillRect(20 - i * 30, 1574 + i * 60, W - 40 + i * 60, 6);
});
const FACADE = (() => {                                        // the engraving, on transparent ground (the sky is its own ink)
  const d = FACADE_TONE.getContext('2d').getImageData(0, 0, W, H).data;
  const inside = (x, y) => { if (y >= 1520) return true; if (y >= 660 && x >= 90 && x <= 990) return true; if (y >= 560 && y < 660 && x >= 40 && x <= 1040) return true;
    return y >= 250 && y < 560 && Math.abs(x - 540) <= (y - 250) / 310 * 500; };
  const ink = [36, 20, 16];
  return pixels(W, H, (x, y) => {
    if (!inside(x, y)) return [0, 0, 0, 0];
    const L = d[(y * W + x) * 4] / 255, dark = 1 - L;
    const p1 = (y + noise3(x * 0.01, y * 0.01, 2) * 3) / 7, f1 = Math.abs(p1 - Math.round(p1));            // horizontal rules
    const p2 = (x * 0.8 + y * 0.6) / 8, f2 = Math.abs(p2 - Math.round(p2));                                  // the cross hatch
    let a = f1 < dark * 0.42 + 0.02 ? 1 : 0;
    if (dark > 0.55 && f2 < (dark - 0.55) * 0.9) a = 1;
    return a ? [ink[0], ink[1], ink[2], 235] : [240, 228, 206, 255];
  });
})();
const FCR = (() => { const r = rng(44), pts = []; let x = 540; for (let y = 1560; y >= 230; y -= 30) { x += (r() - 0.5) * 34; x = lerp(x, 540, 0.12); pts.push([x, y]); } return pts; })();
const FBR = Array.from({ length: 14 }, (_, i) => { const r = rng(90 + i), p = FCR[4 + Math.floor(r() * (FCR.length - 8))]; return { y: p[1], segs: crack(p[0], p[1], { seed: 300 + i, angle: (r() < 0.5 ? Math.PI : 0) + (r() - 0.5) * 1.2 - 0.4, len: 200 + r() * 220, gens: 3, spread: 0.5 }) }; });
const F_BLOWS = [18, 20.5, 23, 25, 30, 33, 35.5, 38, 40.5, 43];
const SKY = mk(W, H, g => {                                   // the second ink: poster red, printed flat with its own voids, the sun left as paper
  const red = mk(W, H, q => {
    q.fillStyle = RED; q.fillRect(0, 0, W, H);
    q.globalCompositeOperation = 'destination-out'; q.beginPath(); q.arc(760, 380, 190, 0, TAU); q.fill();
    q.globalAlpha = 0.25; q.fillStyle = q.createPattern(SPECK, 'repeat'); q.fillRect(0, 0, W, H);
  });
  g.drawImage(PAPER, 0, 0); g.globalCompositeOperation = 'multiply'; g.drawImage(red, 0, 0);
});
const ONE_MORE_SPOTS = [[540, 1640, -0.04, 150], [420, 950, -0.1, 130], [610, 612, 0, 130]];   // steps, column shafts, frieze: a new place every call
function facade(b, t) {
  const S = blowState(F_BLOWS, b), nf = landed(S), top = lerp(1560, 230, clamp(nf / 9.5));
  ctx.drawImage(SKY, 0, 0);
  ctx.drawImage(FACADE, 0, 0);
  put(ctx, word(PIC.frieze, 'poster', 42, { family: 'Archivo Black', track: 0.2, color: '#241410' }), 540, 612);
  const vis = FCR.filter(p => p[1] >= top);
  if (vis.length > 1) {
    const w = y => 4 + 24 * clamp((y - top) / 1300) * (0.4 + nf / 8);
    ctx.fillStyle = INK; ctx.beginPath();
    vis.forEach(([x, y], i) => i ? ctx.lineTo(x - w(y), y) : ctx.moveTo(x - w(y), y));
    for (let i = vis.length - 1; i >= 0; i--) ctx.lineTo(vis[i][0] + w(vis[i][1]), vis[i][1]);
    ctx.fill();
    for (const br of FBR) if (br.y >= top) drawCrack(ctx, br.segs, { grow: clamp((br.y - top) / 300), width: 6, dark: INK, lip: 'rgba(0,0,0,0)' });
  }
  // carved into the enemy's own stone: the cornerstone (the year the treaty took effect) and Gary Works' headcount on the shafts
  ctx.save(); ctx.fillStyle = '#efe4cf'; ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.fillRect(360, 1560, 360, 130); ctx.strokeRect(360, 1560, 360, 130);
  put(ctx, word(PIC.stone[0], 'poster', 34, { family: 'Archivo Black', track: 0.14, color: '#241410' }), 540, 1590);
  put(ctx, word(PIC.stone[1], 'poster', 76, { color: '#241410', track: 0.08 }), 540, 1645); ctx.restore();
  [[345, '30,000', '1970', 800], [540, '6,000', '1990', 985], [735, '5,100', '2015', 1170]].forEach(([x, n, y0, yy]) => {
    put(ctx, word(n, 'poster', 50, { color: '#efe4cf', track: 0.02 }), x, yy, { maxW: 116 });
    put(ctx, word(y0, 'poster', 34, { family: 'Archivo Black', color: '#efe4cf', track: 0.1 }), x, yy + 48, { maxW: 100 });
  });
  const hits = F_BLOWS.filter(x => x <= b + 1e-4).slice(-2).map(x => ({ t: bt(x), x: 540, y: 1540, e: 1000 }));
  drawPuffs(ctx, hits, t, { n: 10, size: 90, color: [220, 200, 170], alpha: 0.5, drift: 200 });
  chips(hits, t, '#e8dcc4', 'flake');
  const depth = 80 + 26 * nf, ex = 560 - SX * 60, ey = 1470 - SY * 60;
  wedge(ex, ey, depth, S);
  hammer(ex - SX * (WL - depth), ey - SY * (WL - depth), S);
}
// the printed sheet tears along the crack (b44.5): the halves fall away onto the red poster
const TORN = FCR.map(([x, y], i) => [x + noise3(i * 0.7, 0, 4) * 10, y]);
function tornEdge(side) {                                       // white paper fibre along the tear
  ctx.save(); ctx.strokeStyle = '#f6efe2'; ctx.lineWidth = 12; ctx.lineJoin = 'round'; ctx.beginPath();
  TORN.forEach(([x, y], i) => { const o = side * (4 + noise3(i * 1.3, side, 2) * 5); i ? ctx.lineTo(x + o, y) : ctx.moveTo(x + o, y); }); ctx.stroke(); ctx.restore();
}
function posterGround(b, t, sun = [540, 760, 330]) {             // the red poster: paper, red ink, a halftone sun
  ctx.drawImage(PAPER, 0, 0);
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = RED; ctx.fillRect(-2000, -2000, W + 4000, H + 4000); ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(SUNHT, sun[0] - 600, sun[1] - 600, 1200, 1200); ctx.restore();
}
const SUNHT = halftone(1200, 1200, (x, y) => { const d = Math.hypot(x - 600, y - 600) / 600; return d < 0.55 ? 0 : clamp((d - 0.55) / 0.45 * 1.2); }, { cell: 16, angle: 0.4, ink: '#f7c860', paper: '#000' });
const T0 = 44.5;
function timber(b, t) {
  const u = clamp((b - T0) / 1.0), f = u * u, sep = 150 * ease.outExpo(Math.max(0, b - T0) * SPB / 0.12);
  posterGround(b, t, [540, 560, 330]);
  for (const side of [-1, 1]) {
    ctx.save();
    const px = side < 0 ? 40 : 1040, py = 1640;
    ctx.translate(px + side * sep, py + f * 700); ctx.rotate(side * f * 1.25); ctx.translate(-px, -py);
    ctx.beginPath(); const xo = side < 0 ? -400 : W + 400;
    ctx.moveTo(xo, -400); ctx.lineTo(TORN[TORN.length - 1][0], -400);
    for (let i = TORN.length - 1; i >= 0; i--) ctx.lineTo(TORN[i][0], TORN[i][1]);
    ctx.lineTo(TORN[0][0], H + 400); ctx.lineTo(xo, H + 400); ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40; ctx.shadowOffsetX = side * 20; ctx.fillStyle = '#efe4cf'; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.clip();
    ctx.drawImage(SKY, 0, 0); ctx.drawImage(FACADE, 0, 0);
    tornEdge(-side);
    ctx.restore();
  }
  const r = rng(5), age0 = (b - T0) * SPB;
  for (let i = 0; i < 40; i++) {
    const age = age0 - r() * 0.5, x0 = 540 + (r() - 0.5) * 500, vx = (r() - 0.5) * 900, y0 = 200 + r() * 600, s = 14 + r() * 50, rot = r() * 6;
    if (age < 0) continue;
    ctx.save(); ctx.translate(x0 + vx * age, y0 + 1800 * age * age); ctx.rotate(rot + age * 5); ctx.fillStyle = i % 3 ? '#efe4cf' : INK; ctx.fillRect(-s / 2, -s / 3, s, s * 0.66); ctx.restore();
  }
}
// after the tear: the wedge stands in the rubble like a monument, on the red poster
function rubble(b, t) {
  posterGround(b, t, [540, 900, 420]);
  const r = rng(9);
  ctx.fillStyle = INK;
  for (let i = 0; i < 80; i++) {
    const x = r() * 1400 - 160, y = 1300 + Math.pow(r(), 0.7) * 700, w = 60 + r() * 220, h = 30 + r() * 90, rot = (r() - 0.5) * 0.8;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  }
  ctx.save(); ctx.translate(260, 1330); ctx.rotate(-0.5); ctx.fillRect(-90, -300, 180, 420); ctx.restore();    // a column drum
  ctx.save(); ctx.translate(860, 1380); ctx.rotate(0.3); ctx.fillRect(-70, -260, 140, 360); ctx.restore();
  const S = blowState([46.5], b);
  ctx.save(); ctx.translate(560, 1330 + 30 * ease.outExpo(S.age / 0.12)); ctx.rotate(Math.PI / 2 + 0.06);
  ctx.drawImage(tintC(WEDGE, INK), -WL - 10, -75); ctx.restore();
  drawPuffs(ctx, [{ t: bt(46.5), x: 560, y: 1300, e: 1800 }], t, { n: 12, life: 1.2, size: 140, color: [40, 10, 8], alpha: 0.5, drift: 300 });
}

// ---------------------------------------------------------------- the payoff: the cornerstone parts along the slash onto the worker (the
// tapper, from the film), and the ACP emblem burns out of the split as light. Past the mark (b88) the light does not cut away: it
// grows, takes the frame, and the ☭≡/acc lockup comes up out of it on the piece's red ground while the open A rings.
// the two halves of the stone, slid apart across the slash by sep, their broken edges lit from behind
function stoneHalves(sep, glow = 1) {
  if (sep >= 1080) return;
  const e = W_STONE.E, p = W_STONE.path;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * sep * -NX, side * sep * -NY);
    const edge = new Path2D(); let first = true;
    for (const [d, o] of p) { const x = e[0] + SX * (d - 900) + NX * o, y = e[1] + SY * (d - 900) + NY * o; first ? edge.moveTo(x, y) : edge.lineTo(x, y); first = false; }
    const xo = side < 0 ? -1500 : W + 1500;
    ctx.save(); ctx.beginPath(); ctx.moveTo(xo, -1500);
    for (const [d, o] of p) ctx.lineTo(e[0] + SX * (d - 900) + NX * o, e[1] + SY * (d - 900) + NY * o);
    ctx.lineTo(xo, H + 1500); ctx.closePath(); ctx.clip();
    ctx.drawImage(GRANITE, TOX, TOY); ctx.fillStyle = 'rgba(14,6,6,0.42)'; ctx.fillRect(-200, -200, W + 400, H + 400);
    ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(26px)'; ctx.strokeStyle = `rgba(255,140,50,${0.8 * glow})`; ctx.lineWidth = 70; ctx.stroke(edge);
    ctx.restore();
    ctx.save(); ctx.strokeStyle = `rgba(255,214,150,${0.9 * glow})`; ctx.lineWidth = 5; ctx.stroke(edge); ctx.restore();
    ctx.restore();
  }
}
const footFrame = (name, b, b0, f0, fps) => { const A = FOOT[name]; return A[clamp(Math.floor(f0 + (b - b0) * SPB * fps), 0, A.length - 1)]; };
// take c: under CL71 the stone opens a little more on every blow onto the workers behind it, so the class line plays over them
const C_OPEN = [[77, 150], [79, 300], [81, 470], [83, 660]];
function reveal(name, b0, f0, fps = 12) {
  return (b, t) => {
    ctx.drawImage(footFrame(name, b, b0, f0, fps), 0, 0, W, H);
    let sep = 0; for (const [bb, s] of C_OPEN) if (b >= bb) sep = lerp(sep, s, ease.outExpo(clamp((b - bb) * SPB / 0.14)));
    stoneHalves(sep, 1);
    const S = blowState(C_OPEN.map(x => x[0]), b);
    if (S.n) drawSparks(ctx, [{ t: bt(C_OPEN[S.n - 1][0]), x: 540, y: 900, e: 1000 }], t, { n: 14, speed: 1200, life: 0.45, color: '#ffb050' });
  };
}
function emblemLight(x, y, size, a, white = 0) {
  if (a <= 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [bl, al] of [[size * 0.16, 0.55], [size * 0.05, 0.6]]) { ctx.filter = `blur(${bl}px)`; acpEmblem(ctx, x, y, size, { color: '#ffb060', alpha: a * al }); }
  ctx.filter = 'none'; acpEmblem(ctx, x, y, size, { color: white > 0.5 ? '#fffaf0' : '#fff0d0', alpha: a * 0.95 });
  ctx.restore();
}
function payoff(b, t) {
  const u = (b - 84) * SPB;
  const z = lerp(1.16, 1.0, ease.outCubic(clamp(u / 3)));
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
  ctx.drawImage(footFrame('rake', b, 84, 12, 4), 0, 0, W, H); ctx.restore();          // the tapper, moving at a quarter of the film's pace
  stoneHalves(TAKE === 'c' ? lerp(660, 1100, ease.outCubic(clamp(u / 0.22))) : ease.outCubic(clamp(u / 0.22)) * 1100);
  emblemLight(820, 430, lerp(230, 300, ease.inOutCubic(clamp(u / 1.6))), ease.outExpo(clamp(u / 0.25)));
}
function payoffWord(b) {                                         // OURS. held over the split: cream on an ink band, the piece's last word
  const u = (b - 84) * SPB, s = ease.outExpo(u / 0.12), out = b >= 88 ? 1 - clamp((b - 88) * SPB / 0.45) : 1;
  if (out <= 0) return;
  ctx.save(); ctx.globalAlpha = out;
  ctx.fillStyle = 'rgba(20,6,6,0.94)'; ctx.fillRect(0, 1400, W, 300); ctx.fillStyle = RED; ctx.fillRect(0, 1400, W, 12);
  put(ctx, word('OURS.', 'poster', 300, { color: CREAM }), 540, 1555, { scale: lerp(1.25, 1, s), maxW: 1000 });
  ctx.restore();
}
// past the mark: the worker stays under the light; the emblem's light grows to the frame's centre and takes it; the red ground
// is printed over it, and the lockup is what the light leaves
function closerRW(b, t) {
  const age = (b - 88) * SPB;
  const k = ease.inOutCubic(clamp(age / 0.9)), wash = Math.exp(-Math.pow((age - 0.7) / 0.35, 2));
  payoff(b, t);
  emblemLight(lerp(820, 540, k), lerp(430, 900, k), lerp(300, 1100, k), 1 - 0.6 * clamp((age - 0.8) / 0.6), k);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const wg = ctx.createRadialGradient(540, 900, 50, 540, 900, 1300);
  wg.addColorStop(0, `rgba(255,236,200,${0.95 * wash})`); wg.addColorStop(1, `rgba(255,120,40,${0.4 * wash})`); ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H); ctx.restore();
  const g = clamp((age - 0.55) / 0.6);                           // the red ground, printed over the light
  if (g > 0) {
    ctx.save(); ctx.globalAlpha = g; ctx.drawImage(PAPER, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = RED; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalAlpha = g * (1 - clamp((age - 1.4) / 1.2)); ctx.globalCompositeOperation = 'screen';
    const eg = ctx.createRadialGradient(540, 900, 30, 540, 900, 700); eg.addColorStop(0, 'rgba(255,190,110,0.55)'); eg.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H); ctx.restore();   // the last of the light, under the mark
  }
  const a = ease.outCubic(clamp((age - 0.75) / 0.5));
  if (a > 0) sigil(ctx, W / 2, 900, 230 * lerp(1.12, 1, a), { color: CREAM, accent: INK, alpha: a });
  line(ctx, 'ACP.US', W / 2, 1230, { family: 'Archivo Black', size: 76, color: CREAM, alpha: clamp((age - 1.3) * 3) });
}

// ================================================================ the type: one system, set above the picture, never cut, cracked or masked
// Every frame of the script is an ink slab with cream capitals (Anton), the source's own capitals in sun-yellow. Lines are
// split at the sentence's joints; a leading '~' sets a line small (the header that persists, the credit).
const SUN = '#f7c860';
const capMeasure = (g, segs, size) => { g.font = `${size}px "Anton"`; let w = 0; for (const s of segs) w += g.measureText(s.t).width + size * 0.02 * s.t.length; return w; };
function capRows(c) {
  return c.t.split('/').map(l => {
    let at = c.s; const m = l.match(/^@([0-9.]+) /); if (m) { at = +m[1]; l = l.slice(m[0].length); }
    const small = l[0] === '~'; if (small) l = l.slice(1);
    const big = l[0] === '!'; if (big) l = l.slice(1);
    const segs = l.split('*').map((t, i) => ({ t, em: i % 2 === 1 })).filter(s => s.t);
    return { segs, small, big, at };
  });
}
// one size for every full line of a card (the widest line sets it), so a clause reads as one voice, not a ransom note
function capLayout(c) {
  if (c.L) return c.L;
  const rows = capRows(c);
  let full = 165;
  for (const r of rows) if (!r.small && !r.big) { const w = capMeasure(ctx, r.segs, 165); if (w + 64 > 960) full = Math.min(full, 165 * (960 - 64) / w); }
  const meas = rows.map(r => { const sz = r.small ? 70 : r.big ? 280 : full; return { ...r, sz, w: capMeasure(ctx, r.segs, sz) }; });
  return (c.L = meas);
}
function caption(b, y1 = 1600) {
  const c = CUES.find(x => b >= x.s && b < x.e); if (!c) return;
  const meas = capLayout(c);
  const h = m => m.sz * 1.16, total = meas.reduce((a, m) => a + h(m) + 8, -8);
  y1 = c.y || Math.min(y1, 1740 - total / 2);                                                // the whole card clears the phone's lower chrome
  const age = (b - c.s) * SPB, pop = age < 0.08 ? 1 + 0.05 * (1 - age / 0.08) : 1;
  ctx.save(); ctx.translate(W / 2, y1 - total / 2); ctx.scale(pop, pop); ctx.translate(-W / 2, total / 2 - total);
  let y = 0;
  for (const m of meas) {
    const sw = m.w + 64, x0 = W / 2 - sw / 2, hh = h(m), la = (b - m.at) * SPB;
    if (la >= 0) {
      const lp = la < 0.08 ? 1 + 0.06 * (1 - la / 0.08) : 1;                                  // a line arriving on its blow
      ctx.save(); ctx.translate(W / 2, y + hh / 2); ctx.scale(lp, lp); ctx.translate(-W / 2, -(y + hh / 2));
      ctx.fillStyle = 'rgba(20,6,6,0.95)'; ctx.fillRect(x0, y, sw, hh);
      ctx.fillStyle = RED; ctx.fillRect(x0, y, 12, hh);                                        // the ACP slash bar's red at the slab's edge
      ctx.textBaseline = 'alphabetic'; ctx.font = `${m.sz}px "Anton"`; let x = x0 + 32;
      for (const sg of m.segs) { ctx.fillStyle = sg.em ? SUN : CREAM; ctx.fillText(sg.t, x, y + hh * 0.83); x += ctx.measureText(sg.t).width + m.sz * 0.02 * sg.t.length; }
      ctx.restore();
    }
    y += hh + 8;
  }
  ctx.restore();
}

// ================================================================ footage: Steel: Man's Servant (1938), baked to four-ink silkscreen
const foot = (name, b0, f0, fps = 12) => (b, t) => {
  const A = FOOT[name], i = clamp(Math.floor(f0 + (b - b0) * SPB * fps), 0, A.length - 1);
  ctx.drawImage(A[i], 0, 0, W, H);
};

// ================================================================ the cut list: [beat, draw(b, t), camera [cx, cy, zoom, rot, push/s, shake]]
// the picture cuts on the blows (a shot is one to three beats); the type above it holds across two to four.
const strike = Wd => (b, t) => strikeScene(Wd, b, t);
const CAP50 = { kind: 'cap', x: 560, y0: -300, y1: 1520, b0: 50, b1: 51.1, sc: 1.4, rot: 0.3 };
const G53 = { kind: 'gilt', k: 1, x: 540, y0: -560, y1: 1380, b0: 53, b1: 54, sc: 1.1, rot: -0.08 };
const G55 = { kind: 'gilt', k: 2, x: 540, y0: 1080, y1: 1480, b0: 54.6, b1: 56, sc: 1.25, rot: 0.06 };
const DROWN = [{ kind: 'gilt', k: 3, x: 300, y0: 1000, y1: 1560, b0: 64, b1: 70, sc: 0.9, rot: 0.1, heat: 1 },
  { kind: 'gilt', k: 4, x: 770, y0: 880, y1: 1500, b0: 64, b1: 69.5, sc: 0.95, rot: -0.07, heat: 1 },
  { kind: 'gilt', k: 5, x: 540, y0: 1150, y1: 1700, b0: 64, b1: 69, sc: 1.05, rot: 0.03, heat: 1 },
  { kind: 'cap', x: 830, y0: 1150, y1: 1420, b0: 64, b1: 70, sc: 0.8, rot: -0.4 }];
const SHOTS_PUB = [
  // ---- HAZ, sentence one: build against the grain (wood, then marble, then the crest of the false cosmos)
  [0, strike(W_WOOD), [600, 820, 0.92, 0]],                  // STALIN MEANS: the sledge already down
  [1, strike(W_WOOD), [760, 640, 1.9, -0.12]],
  [2, strike(W_WOOD), [900, 300, 2.3, 0.2, 0.1]],            // TO BUILD: macro on the mushroomed head
  [3, strike(W_WOOD), [520, 900, 0.72, 0.3]],
  [4, strike(W_WOOD), [560, 1000, 1.25, -0.12, 0.1, 10]],    // AGAINST THE GRAIN: the split runs down the grain
  [5.5, strike(W_WOOD), [640, 700, 0.62, -0.2, 0.08, 14]],   // GRAIN: the block opens
  [7, strike(W_WOOD), [230, 1500, 1.6, 0.12]],               // TO DEFY: the crack runs ahead of the tip
  [8.5, strike(W_MARBLE), [560, 900, 0.95, 0]],              // ALL THE ODDS: marble, the harder stuff
  [10.5, strike(W_MARBLE), [760, 520, 1.9, -0.25, 0.08]],    // IMPOSED BY
  [12, strike(W_MARBLE), [430, 1120, 1.15, 0.08, 0.1]],      // APPARENT WORLD ORDER
  [13.5, strike(W_MARBLE), [520, 900, 0.7, 0.35, 0.08, 14]],
  [15, crest, [540, 900, 1.0, 0, 0.05, 12]],                 // AND ITS FALSE COSMOS: the crest (ordo) fractures
  [16.5, crest, [540, 720, 1.5, -0.05, 0.1]],
  // ---- G12: the university's own engraving; the crack climbs the columns
  [18, facade, [540, 1000, 1.08, 0, 0.04]],                   // MOST WESTERN UNIVERSITIES
  [19.5, facade, [560, 1450, 1.7, 0.1]],
  [21, facade, [760, 420, 1.6, -0.15]],                      // ARE FOUR YEAR
  [22.5, facade, [540, 1300, 1.0, 0.03]],
  [23.5, facade, [560, 1480, 1.3, -0.06, 0.06, 8]],          // ADULT DAYCARE PROGRAMS,
  [25, facade, [540, 700, 1.4, 0.06, 0.06, 8]],
  [26.5, (b, t) => plaque(b, t, 27.2), [540, 1000, 0.95, 0.03]],   // EVEN THE PRESTIGIOUS ONES: the plaque falls; the laugh is held
  // ---- WX: the experts' record, carved into their own stone
  [30, facade, [540, 1000, 1.08, 0, 0.03, 10]],              // THE EXPERTS GAVE US
  [31.5, facade, [540, 1610, 2.4, 0.02, 0.05]],              // the cornerstone: the year the treaty took effect
  [33, facade, [540, 1610, 2.6, -0.03, 0.05, 14]],           // NAFTA.
  [35, facade, [540, 640, 1.9, 0.04, 0.05, 14]],             // NEOLIBERALISM.: the frieze, DEAD LEGAL FORMALISM
  [37.5, facade, [540, 1000, 2.1, -0.04, 0.05, 18]],         // DEINDUSTRIALIZATION.: Gary Works on the shafts
  [39.5, facade, [540, 1180, 1.7, 0.03, 0.05, 18]],
  // ---- know them by their fruits; the facade tears
  [40.5, facade, [540, 760, 1.15, 0, 0.05, 22]],             // YE SHALL KNOW THEM (v13: on the b40.5 blow; v12 b41.5)
  [43.5, facade, [540, 900, 1.0, 0.02, 0.06, 26]],           // BY THEIR FRUITS.
  [44.5, timber, [540, 1000, 1.0, 0, 0.1]],
  [46, timber, [540, 1060, 1.12, -0.04, 0.08]],
  [46.5, rubble, [540, 1150, 1.0, 0.04, 0.1]],
  [47, null, null],                                          // one beat of black, the piece's silence
  // ---- the drop: HAZ, sentence three and four. No figures for the experts: their things break and go into the pour, between the
  //      workers of the film; the steelworker takes AND GLORY and holds it through FOR COMMON MAN.
  [48, (b, t) => gallery(b, t, { hit: 48 }), [540, 900, 1.0, 0, 0.04, 10]],                        // HUMILIATION: the empty frames craze
  [49, (b, t) => gallery(b, t, { hit: 48, split: [3, 49] }), [790, 830, 2.0, -0.06, 0.06, 12]],     // one parts along the slash
  [50, (b, t) => pour(b, t, 50, 4, [CAP50]), [540, 960, 1.0, 0, 0.05]],                            // OF "EXPERTS,": the mortarboard into the steel
  [51, foot('rake', 51, 2, 12), [420, 880, 1.15, 0, 0.05]],                                         // the tapper
  [52, (b, t) => gallery(b, t, { hit: 48, fallAt: 52.1 }), [540, 900, 1.0, 0.03, 0.06, 14]],        // GATEKEEPERS,: off the wall
  [53, (b, t) => pour(b, t, 53, 10, [G53]), [540, 1000, 1.05, 0, 0.05]],                           // a frame into the pour
  [54, foot('rake', 54, 22, 12), [460, 860, 1.3, 0, 0.05]],                                         // FALSE ELITES,: the tapper again
  [55, (b, t) => pour(b, t, 55, 14, [G55]), [540, 1150, 1.5, 0.04, 0.06]],                         // the gilt squirms in the heat
  [56, foot('face', 56, 0, 7), [600, 960, 1.0, 0, 0.05]],                                           // AND GLORY: the steelworker turns to us
  [58, foot('face', 56, 0, 7), [640, 780, 1.3, 0, 0.04]],                                           // FOR COMMON MAN.
  [60, foot('face', 56, 0, 7), [630, 740, 1.55, 0.02, 0.04]],
  [62, foot('pour', 62, 6, 12), [540, 960, 1.0, 0, 0.05]],                                          // BUILD,
  [63.5, foot('rake', 63.5, 0, 12), [420, 900, 1.15, 0, 0.05]],                                     // CULTIVATE,
  [65, (b, t) => pour(b, t, 65, 4, DROWN), [540, 1100, 1.0, 0.03, 0.06, 14]],                      // AND WATCH
  [66, (b, t) => pour(b, t, 65, 4, DROWN), [300, 1150, 1.6, -0.05, 0.06, 20]],
  [67, (b, t) => pour(b, t, 65, 4, DROWN), [540, 1150, 1.1, 0.04, 0.05, 24]],                      // THE ENEMY SQUIRM!
  [68.5, (b, t) => pour(b, t, 65, 4, DROWN), [760, 1250, 1.7, -0.08, 0.05, 24]],                   // the last corner goes under
  [70, foot('face', 70, 12, 0), [640, 800, 1.3, 0, 0.03, 20]],                                      // OURS.
  [71, foot('rake', 71, 16, 0), [520, 760, 1.4, 0.02, 0.03, 20]],                                   // OURS.
  // ---- CL71: the cornerstone (1994) takes the blows: WORK, MAS(ter), ALL
  [72, strike(W_STONE), [560, 820, 0.78, 0]],                // A WORKING CLASS
  [73.5, strike(W_STONE), [800, 330, 2.2, 0.12, 0.12]],
  [74.5, strike(W_STONE), [560, 960, 1.05, -0.3, 0.06, 8]],  // THAT IS THE MASTER
  [76, strike(W_STONE), [500, 1030, 1.15, 0.06, 0.1, 8]],
  [77, strike(W_STONE), [560, 880, 0.85, 0.06, 0.08, 18]],   // OF ALL THINGS
  [78.5, strike(W_STONE), [460, 1080, 1.2, -0.05, 0.1, 18]],
  [79, strike(W_STONE), [560, 920, 1.1, 0.22, 0.1, 26]],     // AND THE MOTOR
  [80.5, strike(W_STONE), [560, 900, 0.9, 0.08, 0.1, 26]],
  [81, strike(W_STONE), [560, 860, 1.4, 0.06, 0.1, 30]],     // OF HISTORY.
  [82.5, strike(W_STONE), [440, 1250, 2.0, -0.2, 0.1, 30]],
  [83.5, strike(W_STONE), [540, 900, 1.0, 0, 0.02]],         // the breath: the last crack is a hair
  [84, payoff, [540, 960, 1.0, 0, 0]],                       // OURS.: the split opens on the worker
];
// take c: from OF ALL THINGS the cornerstone opens onto the workers, a little more on every blow
const SHOTS_C = SHOTS_PUB.filter(([b0]) => b0 < 77 || b0 >= 84).concat([
  [77, reveal('pour', 77, 8), [540, 900, 1.0, 0.03, 0.06, 18]], [79, reveal('rake', 79, 6), [540, 900, 1.05, -0.03, 0.06, 22]],
  [81, reveal('face', 81, 8, 7), [560, 860, 1.1, 0.02, 0.06, 26]], [83, reveal('rake', 83, 10), [540, 900, 1.0, 0, 0.03]],
]).sort((a, b) => a[0] - b[0]);
const SHOTS = TAKE === 'c' ? SHOTS_C : SHOTS_PUB;

// ================================================================ frame
const punch = mk(W, H), punchCtx = punch.getContext('2d');
window.renderFrame = async (t) => {
  const b = B.beat(t), frame = Math.round(t * 30);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  if (b >= 88) { closerRW(b, t); paperOver(ctx, 0.1); payoffWord(b); finish.apply(ctx, frame, { grain: 0.06, vignette: 0.35 }); return; }
  let i = SHOTS.length - 1; while (i > 0 && SHOTS[i][0] > b + 1e-6) i--;
  const [b0, draw, c] = SHOTS[i];
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (!draw) return;                                           // beat 47: black, silent
  cam(c, b, b0, () => draw(b, t));
  const kick = B.env('kick', t, 10);
  if (kick > 0.05 && b < 84) {
    punchCtx.clearRect(0, 0, W, H); punchCtx.drawImage(ctx.canvas, 0, 0);
    const z = 1 + 0.03 * kick; ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); ctx.drawImage(punch, 0, 0); ctx.restore();
  }
  paperOver(ctx, b >= 56 && b < 72 ? 0.16 : 0.12);            // everything sits on stock
  caption(b);
  if (b >= 84) payoffWord(b);
  finish.apply(ctx, frame, { grain: 0.08, vignette: 0.4, flash: B.env('impact', t, 9) * 0.35 });
};
window.sceneReady = true;
