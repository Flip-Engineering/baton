// LAB TYPE 2: world type (TYPE studio, cycle 1). The same three lines set in six piece worlds, each line made by
// that world's own process and struck on a hit (lib/fx/type_world.js):
//   hook FED ABOLISHED.  ·  chant OURS.  ·  payoff WE OWN TOMORROW.
//   worlds: engraved note · riso poster · highway sign · stamped steel · letterpress · light in a night sky
// 18 cells of 4 beats on the lab_type track (productive m2, 130 BPM). Cell k = line * 6 + world.
// window.CELLS lists every cell with its hit times and hero still; window.typeInfo() is the frame's type audit.
// ?cell=k renders only that cell at any t (t is taken inside the cell), for quick iteration.
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, rng, outCanvas } from '../lib/kit.js';
import { loadFace, cpuOut, canvas2d } from '../lib/fx/type.js';
import { paperStock, halftoneRamp, finishPlate } from '../lib/fx/type_sets.js';
import { SAFE, setBlock, chantAt, typeAudit, engraved, rubber, riso, highway, steelPlate, stamped, letterpress, skylight } from '../lib/fx/type_world.js';

cpuOut(); const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('lab_type2');
const spb = B.spb, CELL = 4;
const F = Object.fromEntries(await Promise.all(['anton', 'playfair', 'overpass', 'ultra', 'shoulders', 'archivo', 'oranienbaum'].map(async k => [k, await loadFace(k)])));
const WORLDS = ['engraved', 'riso', 'highway', 'stamped', 'letterpress', 'skylight'];
const LINES = ['hook', 'chant', 'payoff'];
const finish = finishPlate({ seed: 5 });

// ---------------------------------------------------------------- hits per cell (real song hits, snapped)
const uniq = a => [...new Set(a.map(x => Math.round(x * 1000) / 1000))].sort((p, q) => p - q);
const STRONG = uniq([...(B.hits.kick || []), ...(B.hits.stamp || []), ...(B.hits.impact || [])]);
const CHANT = uniq([...(B.hits.shout || []), ...(B.hits.stamp || [])]);
const firstAfter = (list, t) => list.find(h => h >= t - 1e-3) ?? t;
const CELLS = [];
for (let li = 0; li < 3; li++) for (let wi = 0; wi < 6; wi++) {
  const k = li * 6 + wi, t0 = k * CELL * spb, t1 = t0 + CELL * spb;
  const A = firstAfter(STRONG, t0 + 0.9 * spb);
  let Bh = STRONG.find(h => h >= A + 0.95 * spb && h <= t1 - 0.75 * spb) ?? A + spb;   // both hits inside the cell
  let ch = []; for (const h of CHANT) if (h >= t0 + 0.5 * spb && h < t1 - 0.3 * spb && (!ch.length || h - ch.at(-1) >= 0.9 * spb)) ch.push(h);
  if (ch.length < 2) ch = [t0 + spb, t0 + 2 * spb, t0 + 3 * spb];
  ch = ch.slice(0, 3);
  const line = LINES[li], world = WORLDS[wi];
  // the hit whose +0.15 s frame must read the whole line, and the still that shows the landed state
  const last = line === 'chant' ? ch[0] : (line === 'hook' ? Bh : A);
  const hero = line === 'chant' ? ch[0] + 0.1 : line === 'hook' ? Bh + (world === 'highway' ? 0.1 : 0.2) : A + (world === 'highway' ? 0.3 : 0.6);
  CELLS.push({ k, line, world, t0, t1, A, B: Bh, chant: ch, check: line === 'chant' ? ch.map(h => h + 0.15) : [last + 0.15], hero });
}
window.CELLS = CELLS;
const ONLY = new URLSearchParams(location.search).get('cell');

// ---------------------------------------------------------------- layouts: role ladder, safe band, one phrase per frame
const HOOK = 'FED ABOLISHED.', CH = 'OURS.', PAY = 'WE OWN TOMORROW.';
const LAY = {
  engraved: {
    hook: setBlock(F.playfair, [{ text: 'FED', cap: 300 }, { text: 'ABOLISHED.', font: F.anton, fill: true }], { role: 'shout', y: 700, gap: 0.3 }),
    chant: setBlock(F.anton, CH, { role: 'slam', cap: 330, y: 760 }),
    payoff: setBlock(F.playfair, [{ text: 'WE', cap: 170 }, { text: 'OWN', font: F.oranienbaum, fill: true, max: 380 }, { text: 'TOMORROW.', font: F.anton, fill: true }], { role: 'payoff', y: 760, gap: 0.24 }),
  },
  riso: {
    hook: setBlock(F.anton, [{ text: 'FED', cap: 440 }, { text: 'ABOLISHED.', fill: true }], { role: 'shout', align: 'left', y: 700, gap: 0.12 }),
    chant: setBlock(F.anton, CH, { role: 'slam', justify: true, y: 760 }),
    payoff: setBlock(F.anton, [{ text: 'WE', cap: 180 }, { text: 'OWN', fill: true, max: 470 }, { text: 'TOMORROW.', fill: true }], { role: 'payoff', align: 'left', y: 770, gap: 0.12 }),
  },
  stamped: {
    hook: setBlock(F.shoulders, [{ text: 'FED', cap: 320 }, { text: 'ABOLISHED.', fill: true }], { role: 'shout', align: 'left', x: 100, maxW: 820, y: 820, gap: 0.26 }),
    chant: setBlock(F.shoulders, CH, { role: 'slam', justify: true, y: 760 }),
    payoff: setBlock(F.shoulders, [{ text: 'WE', cap: 175 }, { text: 'OWN', fill: true, max: 400 }, { text: 'TOMORROW.', fill: true, sx: 0.86 }], { role: 'payoff', align: 'left', x: 110, maxW: 800, y: 770, gap: 0.2 }),
  },
  letterpress: {
    hook: setBlock(F.ultra, [{ text: 'FED', cap: 300 }, { text: 'ABOLISHED.', font: F.anton, fill: true }], { role: 'shout', y: 720, gap: 0.22 }),
    chant: setBlock(F.anton, CH, { role: 'slam', justify: true, y: 760 }),
    payoff: setBlock(F.ultra, [{ text: 'WE', cap: 160 }, { text: 'OWN', font: F.anton, fill: true, max: 400 }, { text: 'TOMORROW.', font: F.anton, fill: true }], { role: 'payoff', y: 770, gap: 0.34 }),
  },
  skylight: {
    hook: setBlock(F.anton, [{ text: 'FED', cap: 320 }, { text: 'ABOLISHED.', fill: true }], { role: 'shout', y: 640, gap: 0.16 }),
    chant: setBlock(F.anton, CH, { role: 'slam', justify: true, y: 700 }),
    payoff: setBlock(F.anton, [{ text: 'WE', cap: 175 }, { text: 'OWN', fill: true, max: 440 }, { text: 'TOMORROW.', fill: true }], { role: 'payoff', align: 'right', y: 700, gap: 0.14 }),
  },
};
typeAudit.plantCap = 170;

// ================================================================ world 1: engraved note (cream stock, burin work)
const ENG = engraved({ ink: '#120d0b', paper: '#eee4cc' }), RUB = rubber({ ink: '#c4161c' });
const NOTE = (() => {
  const P = paperStock({ w: W + 400, h: H + 400, seed: 3, base: [238, 229, 206], tooth: 10, fibres: 1600, burn: 0.1 });
  const L = canvas2d(W + 400, H + 400), g = L.g; g.drawImage(P, 0, 0); g.strokeStyle = 'rgba(22,16,14,0.62)';
  g.lineWidth = 0.55;                                    // wavy tint over the whole plate
  for (let y = 0; y < H + 400; y += 6.5) { g.beginPath(); for (let x = 0; x <= W + 400; x += 6) { const yy = y + 2.6 * Math.sin(x / 48 + y * 0.03); x ? g.lineTo(x, yy) : g.moveTo(x, yy); } g.stroke(); }
  const rose = (cx, cy, R0, n, k, amp, lw) => { g.lineWidth = lw; for (let i = 0; i < n; i++) { const r0 = R0 * (1 - i / (n + 4)), ph = i * 0.41; g.beginPath();
    for (let j = 0; j <= 720; j++) { const a = j / 720 * Math.PI * 2, rr = r0 + r0 * amp * Math.sin(k * a + ph); const X = cx + rr * Math.cos(a), Y = cy + rr * Math.sin(a); j ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke(); } };
  g.strokeStyle = 'rgba(18,12,10,0.8)'; rose(W + 250, 1500, 620, 34, 24, 0.035, 0.8); rose(W + 250, 1500, 300, 16, 12, 0.05, 0.7);
  rose(40, 260, 330, 20, 18, 0.04, 0.7);
  for (const y of [150, 1560]) for (let j = 0; j < 7; j++) { g.lineWidth = 0.9; g.beginPath(); for (let x = 0; x <= W + 400; x += 3) { const yy = y + j * 5 + 9 * Math.sin(x / 22 + j * 0.9); x ? g.lineTo(x, yy) : g.moveTo(x, yy); } g.stroke(); }
  g.fillStyle = 'rgba(18,12,10,0.75)'; g.font = '700 7px "Plex Mono"';          // microtext: sub-legible at any feed size
  for (let k = 0; k < 6; k++) g.fillText('THE PEOPLES NATIONAL BANK · '.repeat(40), -20 + k * 7, 1640 + k * 9);
  g.fillStyle = 'rgba(190,24,30,0.85)'; g.font = '700 22px "Plex Mono"'; g.fillText('A 00000001 A', W - 160, 1720);
  g.getImageData(0, 0, 1, 1); return L.cv;
})();
function worldEngraved(line, t, c) {
  const off = line === 'chant' ? (chantAt(c.chant, t)?.i ?? 0) : 0, on = line === 'chant' ? chantAt(c.chant, t) : null;
  const clearFeed = on && !on.on ? 1 : 0;                           // after the slam the next note is under the stamp
  const ox = -200 + ((off + clearFeed) * 137) % 260, oy = -180 + ((off + clearFeed) * 211) % 300, z = 1 + (t - c.t0) * 0.012;
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); ctx.drawImage(NOTE, ox, oy); ctx.restore();
  if (line === 'hook') { const b = LAY.engraved.hook, a = t - c.A; ENG.draw(ctx, b, a, { light: 1 + (t >= c.B ? Math.exp(-(t - c.B) * 5) : 0) }); return reg(b, ENG.readable(b, a)); }
  if (line === 'payoff') { const b = LAY.engraved.payoff, a = t - c.A; ENG.draw(ctx, b, a); return reg(b, ENG.readable(b, a)); }
  const b = LAY.engraved.chant; if (!on || !on.on) return 0;
  ctx.save(); const dy = [0, 170, -140][on.i % 3], dx = [0, -40, 30][on.i % 3]; ctx.translate(dx, dy);
  RUB.draw(ctx, b, on.age, { angle: [-0.11, 0.07, -0.05][on.i % 3] }); ctx.restore();
  return reg(b, RUB.readable(b, on.age), { dx, dy });
}

// ================================================================ world 2: riso poster (two drums, overprint)
const RIS = riso({ seed: 4 }), RK = '#221c1e', RR = '#e3242b';
const RPAPER = paperStock({ seed: 8, base: [245, 241, 232], tooth: 9, fibres: 900, burn: 0.04 });
const HT = halftoneRamp({ w: W, h: 760, color: '#000', cell: 16, angle: 0.785, max: 0.66, seed: 3 });
const riPlates = {
  bandK: RIS.plate(g => { g.save(); g.translate(0, 1180); g.drawImage(HT, 0, 0); g.restore(); g.fillRect(0, 1740, W, 180); }, RK, { key: 'bandK' }),
  barR: RIS.plate(g => { g.save(); g.translate(W / 2, 505); g.rotate(-0.06); g.fillRect(-640, -52, 1280, 104); g.restore(); }, RR, { key: 'barR' }),
  discR: RIS.plate(g => { g.beginPath(); g.arc(760, 1380, 520, 0, 7); g.fill(); }, RR, { key: 'discR', seed: 9 }),
  wedgeR: RIS.plate(g => { g.beginPath(); g.moveTo(0, 1140); g.lineTo(W, 900); g.lineTo(W, 1320); g.lineTo(0, 1500); g.fill(); }, RR, { key: 'wedgeR', seed: 6 }),
  // (not text) a halftone disc for the chant sheet; the word is the red drum
  discK: RIS.plate(g => { g.save(); g.beginPath(); g.arc(300, 1320, 560, 0, 7); g.clip(); g.drawImage(HT, -200, 900, W + 400, 900); g.restore(); }, RK, { key: 'discK', seed: 11 }),
};
function worldRiso(line, t, c) {
  let jolt = 0; const hits = line === 'chant' ? c.chant : [c.A, c.B];
  for (const h of hits) if (t >= h && t - h < 0.07) jolt = 3;
  ctx.save(); ctx.translate(0, jolt); ctx.drawImage(RPAPER, 0, 0);
  let rd = 0;
  if (line === 'hook') {
    const b = LAY.riso.hook, a = t - c.A, a2 = t - c.B;
    RIS.print(ctx, riPlates.bandK, a, { reg: [0, 0] }); RIS.print(ctx, RIS.plate(b, RK), a, { reg: [0, 0] });
    RIS.print(ctx, riPlates.barR, a2, { reg: [7, -5], rot: 0.004 }); RIS.print(ctx, riPlates.wedgeR, a2, { reg: [7, -5], rot: 0.004 });
    rd = reg(b, RIS.readable(a));
  } else if (line === 'payoff') {
    const b = LAY.riso.payoff, a = t - c.A;
    RIS.print(ctx, riPlates.bandK, t - c.t0, {}); RIS.print(ctx, RIS.plate(b, RK, { only: [0, 2] }), a + 0.23, {});
    RIS.print(ctx, riPlates.discR, a, { reg: [-6, 8], rot: -0.003 }); RIS.print(ctx, RIS.plate(b, RR, { only: [1] }), a, { reg: [-6, 8], rot: -0.003 });
    rd = reg(b, RIS.readable(a));
  } else {
    const b = LAY.riso.chant, on = chantAt(c.chant, t);
    RIS.print(ctx, riPlates.discK, t - c.t0 + 1, {});
    if (on && on.on) { const r = [[-8, 6, -0.03], [9, -7, 0.025], [-5, -9, -0.015]][on.i % 3], dy = [0, 190, -120][on.i % 3];
      ctx.save(); ctx.translate(0, dy); RIS.print(ctx, RIS.plate(b, RR), on.age, { reg: [r[0], r[1]], rot: r[2] }); ctx.restore(); rd = reg(b, RIS.readable(on.age), { dy }); }
  }
  ctx.restore(); return rd;
}

// ================================================================ world 3: highway at night (the sign is an object)
const HW = highway({ face: F.overpass });
const SIGNS = {       // Series E-like Overpass for short words; long words compressed toward Series B (sx 0.6)
  hook: HW.sign([{ text: 'FED', cap: 250 }, { text: 'ABOLISHED', sx: 0.62, fill: true }], { wM: 9.2, hM: 5.6 }),
  payoff: HW.sign([{ text: 'WE', cap: 175 }, { text: 'OWN', fill: true, max: 360, sx: 0.8 }, { text: 'TOMORROW', sx: 0.6, fill: true }], { wM: 10, hM: 9.3 }),
};
const VMS = HW.vms('OURS', { cols: 36, rows: 17, pitchM: 0.2, cap: 0.82 });
const HY = 1430, FOC = 950, CAMH = 2.3;
const P = (X, Y, d) => d <= 0.3 ? null : { x: SAFE.cx + FOC * X / d, y: HY - FOC * (Y - CAMH) / d, s: FOC / d };
const SKY = (() => { const L = canvas2d(), g = L.g, r = rng(2);
  const gr = g.createLinearGradient(0, 0, 0, HY); gr.addColorStop(0, '#03040a'); gr.addColorStop(0.7, '#0b0a14'); gr.addColorStop(1, '#2a150c'); g.fillStyle = gr; g.fillRect(0, 0, W, HY);
  g.fillStyle = '#050505'; g.fillRect(0, HY, W, H - HY);
  for (let k = 0; k < 260; k++) { const x = r() * W, y = HY - 4 - r() * 30 * r(); g.fillStyle = r() < 0.15 ? 'rgba(255,60,40,0.9)' : `rgba(255,${170 + r() * 60 | 0},90,${0.4 + r() * 0.6})`; g.fillRect(x, y, 1.5 + r() * 2, 1.5 + r() * 1.5); }
  for (let k = 0; k < 7; k++) { const x = 80 + r() * 900, h = 60 + r() * 90; g.strokeStyle = 'rgba(40,36,40,0.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, HY - 4); g.lineTo(x, HY - h); g.lineTo(x + 70, HY - h); g.stroke(); g.fillStyle = 'rgba(255,40,30,0.9)'; g.fillRect(x - 2, HY - h - 4, 4, 4); }
  g.getImageData(0, 0, 1, 1); return L.cv; })();
function road(t, v, Z) {
  ctx.fillStyle = '#0a0a0b'; const L = P(-9, 0, 2.2), R = P(9, 0, 2.2), Lf = P(-9, 0, 400), Rf = P(9, 0, 400);
  ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(R.x, R.y); ctx.lineTo(Rf.x, Rf.y); ctx.lineTo(Lf.x, Lf.y); ctx.fill();
  const pool = ctx.createRadialGradient(SAFE.cx, H + 200, 60, SAFE.cx, H + 200, 900);      // low beams on the asphalt
  pool.addColorStop(0, 'rgba(255,236,200,0.34)'); pool.addColorStop(1, 'rgba(255,236,200,0)'); ctx.fillStyle = pool; ctx.fillRect(0, HY, W, H - HY);
  for (const X of [-7.4, 7.4]) { ctx.strokeStyle = 'rgba(235,230,215,0.8)'; ctx.lineWidth = 3; const a = P(X, 0, 2.4), b = P(X, 0, 300); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  for (let n = Math.floor(Z / 45) + 1; n < Math.floor(Z / 45) + 9; n++) for (const X of [-10.5, 10.5]) {   // sodium poles passing
    const d = n * 45 - Z; if (d < 3) continue; const a = P(X, 0, d), b = P(X, 11, d), h = P(X * 0.8, 10.8, d);
    ctx.strokeStyle = `rgba(40,38,40,${clamp(1.4 - d / 300)})`; ctx.lineWidth = Math.max(1, 0.25 * a.s); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(h.x, h.y); ctx.stroke();
    const r = Math.max(2, 0.5 * a.s), gr = ctx.createRadialGradient(h.x, h.y + r * 0.3, 0, h.x, h.y + r * 0.3, r * 5);
    gr.addColorStop(0, 'rgba(255,190,110,0.9)'); gr.addColorStop(0.15, 'rgba(255,150,60,0.35)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = gr; ctx.fillRect(h.x - r * 5, h.y - r * 5, r * 10, r * 10); }
  for (const X of [-3.7, 0, 3.7]) for (let n = Math.floor(Z / 12); n < Math.floor(Z / 12) + 26; n++) {
    const z0 = n * 12 - Z, z1 = z0 + 3; if (z1 < 2.4) continue; const a = P(X - 0.08, 0, Math.max(2.4, z0)), b = P(X + 0.08, 0, z1), a2 = P(X + 0.08, 0, Math.max(2.4, z0)), b2 = P(X - 0.08, 0, z1);
    const lit = clamp(1.2 - z0 / 70); ctx.fillStyle = `rgba(245,240,225,${0.15 + 0.8 * lit})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a2.x, a2.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.fill(); }
}
function worldHighway(line, t, c) {
  const plan = line === 'payoff' ? { v: 2, dHit: 10.9, at: c.A } : line === 'hook' ? { v: 5, dHit: 10.2, at: c.B } : { v: 1.2, dHit: 8.2, at: c.chant[1] ?? c.chant[0] };
  const Z = plan.v * t, Zs = plan.v * plan.at + plan.dHit, d = Zs - Z;
  const shake = line !== 'chant' ? Math.sin(t * 43) * 1.2 : 0;
  ctx.save(); ctx.translate(0, shake); ctx.drawImage(SKY, 0, 0); road(t, plan.v, Z);
  const flashAt = h => t >= h ? Math.exp(-(t - h) * 5) : 0;
  let rd = 0;
  if (line === 'chant') {
    const q = P(0, 7.2, d), on = chantAt(c.chant, t), V = VMS;
    const lum = HW.lum(d, 7.2 - 3.8, 0);
    HW.gantry(ctx, P, d + 0.4, { yLo: 5.6, yHi: 8.9, lum });
    HW.drawVms(ctx, V, q.x, q.y, q.s, on && on.on ? 1 : 0, { lum });
    if (on && on.on) { const p = V.pitchM * q.s, cap = V.capRows * p, w = V.wCols * p;       // the lit word, in screen px
      const blk = { text: 'OURS', role: 'slam', caps: [cap], bbox: { x1: q.x - w / 2, x2: q.x + w / 2, y1: q.y - cap / 2, y2: q.y + cap / 2 } };
      rd = reg(blk, 1); }
  } else {
    const S = SIGNS[line], Ys = line === 'payoff' ? 10.2 : 8.4, q = P(0, Ys, d);
    const lum = HW.lum(d, Ys - 3.8, line === 'hook' ? flashAt(c.A) * 0.6 + flashAt(c.B) * 0.7 : flashAt(c.A) * 0.9);
    if (q) {
      HW.gantry(ctx, P, d + 0.5, { yLo: Ys - S.hM / 2 - 0.2, yHi: Ys + S.hM / 2 - 0.4, lum: lum * 0.7 });
      const box = HW.draw(ctx, S, q.x, q.y, q.s, lum), k = q.s / S.pxPerM;
      const blk = { text: S.block.text, role: line === 'payoff' ? 'payoff' : 'shout', caps: S.block.caps.map(v => v * k),
        bbox: { x1: box.x1 + S.bb.x1 * k, x2: box.x1 + S.bb.x2 * k, y1: box.y1 + S.bb.y1 * k, y2: box.y1 + S.bb.y2 * k } };
      rd = reg(blk, HW.readable(lum));
    }
  }
  ctx.restore(); return rd;
}

// ================================================================ world 4: stamped steel (letter punches)
const STEEL = steelPlate({ w: W + 500, h: H + 500, seed: 6, tone: 138 }), STP = stamped({ seed: 13 });
function worldStamped(line, t, c) {
  let strikes, b = LAY.stamped[line], on = null, dx = 0, dy = 0;
  if (line === 'hook') strikes = b.glyphs.map(G => G.line === 0 ? c.A : c.B);
  else if (line === 'payoff') strikes = b.glyphs.map(G => [c.A - 2 * spb, c.A - spb, c.A][G.line]);
  else { on = chantAt(c.chant, t); strikes = on ? on.h : 1e9; }
  const plateK = line === 'chant' ? (on ? on.i * 2 + (on.on ? 0 : 1) : 0) : 0;         // a fresh plate after every slam
  const sh = STP.shake(b, t, strikes) * 14, r = rng(Math.floor(t * 30));
  ctx.save(); ctx.translate((r() - 0.5) * sh, (r() - 0.5) * sh);
  ctx.drawImage(STEEL, -250 - (plateK * 173) % 240, -250 - (plateK * 97) % 260);
  if (line === 'chant') { if (on && on.on) { dy = [0, 180, -150][on.i % 3]; ctx.save(); ctx.translate(dx, dy); STP.draw(ctx, b, t, strikes); ctx.restore(); } }
  else { ctx.save(); const [cx, cy] = [510, 760], ang = line === 'payoff' ? -0.11 : -0.07; ctx.translate(cx, cy); ctx.rotate(ang); ctx.translate(-cx, -cy); STP.draw(ctx, b, t, strikes); if (line === 'payoff') STP.paint(ctx, b, clamp((t - c.A - 0.12) / 0.4)); ctx.restore(); }
  ctx.restore();
  if (line === 'chant' && !(on && on.on)) return 0;
  return reg(b, STP.readable(b, t, strikes), line === 'chant' ? { dx, dy } : { rot: line === 'payoff' ? -0.11 : -0.07, pivot: [510, 760] });
}

// ================================================================ world 5: letterpress (wood type, platen on the kick)
const LP = letterpress({ seed: 14 });
const LPAPER = paperStock({ seed: 12, base: [236, 225, 200], tooth: 12, fibres: 1800, burn: 0.16 });
function sheet(k) {           // the sheet laid on the press: dark platen/tympan showing at the edges, the sheet a hair skewed
  ctx.fillStyle = '#16120f'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate((k % 3 - 1) * 0.004); ctx.translate(-W / 2, -H / 2);
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 18; ctx.drawImage(LPAPER, 0, 0, W, H, 34, 70, W - 68, H - 140); ctx.restore();
  ctx.fillStyle = '#26211d'; for (const x of [150, 880]) ctx.fillRect(x, 50, 46, 44);      // gripper fingers holding the top edge
}
const RULES = (b => { const L = canvas2d(), g = L.g; g.fillStyle = '#171213';          // brass rules above and below the key word
  const l = b.lines[1].bbox, y1 = l.y1 - 0.12 * b.caps[1], y2 = l.y2 + 0.12 * b.caps[1];
  for (const [y, h] of [[y1 - 20, 12], [y1 - 2, 4], [y2 - 2, 4], [y2 + 10, 12]]) g.fillRect(b.bbox.x1, y, b.bbox.x2 - b.bbox.x1, h);
  return { lines: [], glyphs: [], bbox: b.bbox, cv: L.cv }; })(LAY.letterpress.payoff);
function worldLetterpress(line, t, c) {
  const b = LAY.letterpress[line];
  if (line === 'hook') { sheet(0); LP.print(ctx, LP.impression(b, { fountain: ['#d0181f', '#c3161d', '#5a0e12', '#171213'] }), t - c.A); LP.shade(ctx, t - c.A); return reg(b, LP.readable(t - c.A)); }
  if (line === 'payoff') {
    sheet(1); const blk = c.A - spb;
    LP.print(ctx, LP.impression(b, { ink: '#171213', only: [0, 2] }), t - blk);
    if (t >= blk) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.9; ctx.drawImage(RULES.cv, 0, 0); ctx.restore(); }
    LP.shade(ctx, t - blk, { dur: 0.16 });
    LP.print(ctx, LP.impression(b, { ink: '#c3161d', only: [1] }), t - c.A); LP.shade(ctx, t - c.A);
    return reg(b, t >= c.A ? 1 : 0);
  }
  const on = chantAt(c.chant, t); sheet(on ? on.i + 2 : 2);
  if (on && on.on) { LP.print(ctx, LP.impression(b, { ink: '#171213', key: 'ch' }), on.age); return reg(b, LP.readable(on.age)); }
  const nx = c.chant.find(h => h > t); if (nx) LP.shade(ctx, t - nx, { dur: 0.14 });
  return 0;
}

// ================================================================ world 6: light in a night sky (a drone formation)
const SKYL = skylight({ seed: 5 });
const CITY = (() => {
  const L = canvas2d(), g = L.g, r = rng(17), win = [];
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#02030a'); gr.addColorStop(0.62, '#0a0a1a'); gr.addColorStop(0.78, '#2b1418'); gr.addColorStop(1, '#0a0508');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 180; k++) { g.fillStyle = `rgba(230,230,255,${0.2 + r() * 0.5})`; g.fillRect(r() * W, r() * H * 0.55, 1.4, 1.4); }
  let x = -20;
  while (x < W + 20) { const w = 40 + r() * 110, h = 120 + r() * r() * 420, top = 1560 - h; g.fillStyle = `rgb(${6 + r() * 6 | 0},${6 + r() * 6 | 0},${10 + r() * 8 | 0})`; g.fillRect(x, top, w, H - top);
    for (let yy = top + 10; yy < 1640; yy += 14) for (let xx = x + 6; xx < x + w - 6; xx += 11) if (r() < 0.32) { const wc = r() < 0.8 ? 'rgba(255,196,120,0.85)' : 'rgba(200,220,255,0.7)'; g.fillStyle = wc; g.fillRect(xx, yy, 5, 7); if (r() < 0.5) win.push([xx + 2, yy + 3]); }
    x += w + r() * 8; }
  const w2 = g.createLinearGradient(0, 1640, 0, H); w2.addColorStop(0, '#0d0710'); w2.addColorStop(1, '#030205'); g.fillStyle = w2; g.fillRect(0, 1640, W, H - 1640);   // the river
  g.save(); g.globalAlpha = 0.35; g.scale(1, -1); g.drawImage(L.cv, 0, 1240, W, 400, 0, -1640 - 400, W, 400); g.restore();
  for (let yy = 1650; yy < H; yy += 5) { g.fillStyle = `rgba(0,0,0,${0.2 + 0.2 * Math.sin(yy * 0.3)})`; g.fillRect(0, yy, W, 2); }
  g.getImageData(0, 0, 1, 1); return { cv: L.cv, win };
})();
const srcFrom = seedK => (i, p) => CITY.win[(i * 7919 + seedK * 104729) % CITY.win.length];
function worldSkylight(line, t, c) {
  ctx.drawImage(CITY.cv, 0, 0);
  const b = LAY.skylight[line];
  if (line === 'hook') { const pts = SKYL.points(b, { spacing: 15 }), a = t - c.A;
    const pulse = t >= c.B ? Math.exp(-(t - c.B) * 6) : 0;
    SKYL.draw(ctx, pts, a, { src: srcFrom(1), arrive: 1.3, red: 0 }); if (pulse > 0.05) { ctx.save(); ctx.globalAlpha = pulse * 0.6; SKYL.draw(ctx, pts, a, { src: srcFrom(1), arrive: 1.3 }); ctx.restore(); }
    return reg(b, SKYL.readable(pts, a)); }
  if (line === 'payoff') { const pts = SKYL.points(b, { spacing: 12 }), a = t - c.A; SKYL.draw(ctx, pts, a, { src: srcFrom(3), arrive: 1.6, red: 0.0 }); return reg(b, SKYL.readable(pts, a)); }
  const pts = SKYL.points(b, { spacing: 19 }), on = chantAt(c.chant, t, { frames: 6 });
  let rd = 0;
  for (let i = 0; i < c.chant.length; i++) { const a = t - c.chant[i]; if (a < -0.4 || a > 0.7) continue;
    SKYL.draw(ctx, pts, a, { src: srcFrom(10 + i), arrive: 0.38, burst: 0.2, spread: 0.2, red: 0.2 });
    rd = Math.max(rd, SKYL.readable(pts, a, { burst: 0.2 })); }
  return rd >= 0.6 ? reg(b, rd) : 0;
}

// ---------------------------------------------------------------- frame
const DRAW = { engraved: worldEngraved, riso: worldRiso, highway: worldHighway, stamped: worldStamped, letterpress: worldLetterpress, skylight: worldSkylight };
let CUR = null;
function reg(block, read, o = {}) { typeAudit.add(block, { read, world: CUR.world, ...o }); return read; }
const cellAt = t => ONLY != null ? CELLS[+ONLY] : CELLS[clamp(Math.floor(t / (CELL * spb)), 0, CELLS.length - 1)];
let LAST_READ = 0;
window.renderFrame = async (t) => {
  const c = cellAt(t); CUR = c; typeAudit.reset();
  if (ONLY != null && (t < c.t0 || t >= c.t1)) t = c.t0 + ((t % (CELL * spb)) + CELL * spb) % (CELL * spb);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  LAST_READ = DRAW[c.world](c.line, t, c) || 0;
  const dark = c.world === 'highway' || c.world === 'skylight';
  finish.apply(ctx, Math.round(t * 30), { grain: dark ? 0.06 : 0.04, vignette: dark ? 0.5 : 0.25 });
};
window.typeInfo = () => ({ read: LAST_READ, items: typeAudit.items });
window.readability = t => LAST_READ;
// prewarm: bake every block's sprites (they are lazy)
for (const w of ['engraved']) for (const l of ['hook', 'payoff']) ENG.warm(LAY.engraved[l]);
RUB.warm(LAY.engraved.chant);
for (const l of LINES) STP.warm(LAY.stamped[l]);
for (const c of CELLS) { await window.renderFrame(c.hero); }
window.sceneReady = true;
