// LAB TYPE C2 (TYPE studio, cycle 2): the press is the cut; payoffs authored as the world's own objects.
// One demo per page load (?demo=...). t is SONG time: every recipe is keyed to one measured onset of the piece's own
// song (research/capabilities/type.md, "TYPE c2"); scripts/type_c2.mjs renders the clip with that song's audio.
//   bank     intaglio pull: burin cuts MONEY. reversed, ink, wipe, the sheet swings up forward on the hit
//   1776     platen: the mirror forme, rollers, the platen closes (2 f dwell) and opens on the sheet on the hit
//   civ      riso: drum 1 red ON the hit, drum 2 black one frame later off register, the next sheet clears
//   wedge    letter punch: O U R S struck on four hammer hits, dent + burr from the rake only
//   stamp    payoff: the teller's dater struck across a Fed note (MONEY. at >= 300 px cap)
//   poster   payoff: the broadside hung on the line in the shop
// &hit=s overrides the demo's onset. window.typeC2(t) returns the state card for the driver.
import { W, H, clamp, lerp, ease, rng, loadFonts } from '../lib/kit.js';
import { loadFace, cpuOut, canvas2d } from '../lib/fx/type.js';
import { paperStock, guilloche, finishPlate } from '../lib/fx/type_sets.js';
import { setBlock, typeAudit, cheapEffects } from '../lib/fx/type_world.js';
import { intaglioPull, platenPress, risoPass, letterPunch, daterStamp, broadside } from '../lib/fx/type_press.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const Q = new URLSearchParams(location.search), DEMO = Q.get('demo') || 'bank';
const ctx = cpuOut();
await loadFonts();
const F = Object.fromEntries(await Promise.all(['anton', 'ultra', 'playfair', 'fell', 'oswald', 'overpass', 'shoulders'].map(async k => [k, await loadFace(k)])));
const finish = finishPlate({ seed: 7 });
// onsets measured on the current songs (scripts/type_sync.py onsets review/studio_type_c2/after/audio/.<scene>.wav)
const HIT = { bank: 10.058, 1776: 19.15, civ: 15.983, wedge: [12.783, 13.992, 14.192, 14.392], stamp: 24.417, poster: 19.15 };
const hitQ = Q.get('hit') ? Q.get('hit').split(',').map(Number) : null;
const hit = hitQ ? (DEMO === 'wedge' ? hitQ : hitQ[0]) : (HIT[DEMO] ?? 1);
typeAudit.plantCap = 170;

let draw, card;
// the 1776 sheet: one broadside object is both the platen's second pass (1776) and the hung payoff (poster)
const SHEET = (DEMO === '1776' || DEMO === 'poster') ? broadside({ faces: { wood: F.ultra, cond: F.anton, body: F.fell }, body: ['When in the course of events, a long train of abuse, corruption and usurpations. A given country can only have one history.',
  'Therefore, the Plenary Committee of the American Communist Party, now assembled in Chicago, Illinois, solemnly declare the American revolutionary tradition beginning in 1776.'],
  imprint: 'CHICAGO: PRINTED ON THE PARTY PRESS.', w: 1000, h: 1560, typeX: 472, typeW: 870 }) : null;
if (DEMO === 'bank') {
  const R = intaglioPull({ font: F.playfair, text: 'MONEY.', cap: 250, hit, y: 900 });
  draw = t => { R.draw(ctx, t); finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.5 }); };
  card = t => ({ ...R.info(t), audit: audit(R.block, R.info(t).reads) });
} else if (DEMO === '1776') {
  const R = platenPress({ faces: { wood: F.ultra, cond: F.anton }, hit, sheetOf: SHEET, sx: 40, sy: 180 });
  draw = t => { R.draw(ctx, t); finish.apply(ctx, Math.round(t * 30), { grain: 0.06, vignette: 0.4 }); };
  card = t => ({ ...R.info(t), audit: audit(R.block, R.info(t).reads) });
} else if (DEMO === 'civ') {
  const R = risoPass({ faces: { cond: F.anton }, hit, clear: 0.95 });
  draw = t => { R.draw(ctx, t); finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.35 }); };
  card = t => ({ ...R.info(t), audit: audit(R.block, R.info(t).reads) });
} else if (DEMO === 'wedge') {
  const R = letterPunch({ font: F.shoulders, text: 'OURS', cap: 520, strikes: hit, y: 760, paintAfter: hit[hit.length - 1] + 0.12 });
  draw = t => { R.draw(ctx, t); finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.3 }); };
  card = t => ({ ...R.info(t), audit: audit(R.block, R.info(t).reads) });
} else if (DEMO === 'stamp') {
  // the Fed note the teller cancels: engraved green-black on pale stock, rosettes, a legend, the denomination
  const note = (() => {
    const L = canvas2d(), g = L.g;
    g.fillStyle = '#16140f'; g.fillRect(0, 0, W, H);                                       // the teller's counter
    const N = { x: 60, y: 170, w: 960, h: 1560 };
    const P = paperStock({ w: N.w, h: N.h, seed: 31, base: [226, 229, 212], tooth: 10, fibres: 2600, burn: 0.1 }); g.drawImage(P, N.x, N.y);
    const G = guilloche({ w: N.w, h: N.h, bg: 'rgba(0,0,0,0)', text: '', serial: '', micro: 0, border: true, rosettes: [
      { x: N.w * 0.5, y: N.h * 0.52, R: 430, r0: 250, k1: 20, k2: 5, n: 40, color: 'rgba(30,70,52,0.22)', lw: 1 },
      { x: N.w * 0.5, y: N.h * 0.52, R: 240, r0: 90, k1: 14, k2: 3, n: 30, color: 'rgba(30,70,52,0.2)' },
      { x: N.w * 0.16, y: N.h * 0.1, R: 120, r0: 60, k1: 16, k2: 4, n: 22, color: 'rgba(20,40,30,0.5)' },
      { x: N.w * 0.84, y: N.h * 0.9, R: 120, r0: 60, k1: 16, k2: 4, n: 22, color: 'rgba(20,40,30,0.5)' } ] });
    g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(G, N.x, N.y); g.restore();
    const ink = (blk, col) => { g.fillStyle = col; for (const q of blk.glyphs) { g.save(); g.translate(q.ox, q.oy); g.fill(q.path); g.restore(); } };
    ink(setBlock(F.playfair, [{ text: 'FEDERAL RESERVE NOTE', cap: 44, tracking: 0.04 }], { role: 'micro', y: 262, maxW: 820 }), '#1d2a22');
    ink(setBlock(F.fell, [{ text: 'THE UNITED STATES OF AMERICA', cap: 30, tracking: 0.1 }], { role: 'micro', y: 318, maxW: 700 }), '#1d2a22');
    ink(setBlock(F.playfair, [{ text: 'ONE', cap: 150 }], { role: 'micro', y: 1560 }), '#23352a');
    ink(setBlock(F.oswald, [{ text: 'L 00000001 A', cap: 34 }], { role: 'micro', x: 250, y: 460 }), '#2c5a3c');
    ink(setBlock(F.oswald, [{ text: 'L 00000001 A', cap: 34 }], { role: 'micro', x: 800, y: 1430 }), '#2c5a3c');
    g.strokeStyle = 'rgba(20,40,30,0.8)'; g.lineWidth = 3; g.strokeRect(N.x + 70, N.y + 60, N.w - 140, N.h - 120);
    g.getImageData(0, 0, 1, 1); return L.cv;
  })();
  const S = daterStamp({ faces: { ring: F.oswald, word: F.shoulders }, word: 'MONEY.', ring: ["THE PEOPLE'S", ''], rcap: 74, date: 'NATIONAL BANK · JUL 4 2036', cx: 525, cy: 950, R0: 600, cap: 300, sx: 0.8, rot: -0.07 });
  draw = t => { ctx.drawImage(note, 0, 0); S.draw(ctx, t - hit);
    const gr = ctx.createRadialGradient(W * 0.35, H * 0.3, 300, W * 0.5, H * 0.5, 1400); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(10,8,5,0.6)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    finish.apply(ctx, Math.round(t * 30), { grain: 0.04, vignette: 0.3 }); };
  card = t => ({ stamp: S.audit(), audit: audit(S.word, t >= hit ? 1 : 0, { ...S.place }) });
} else if (DEMO === 'poster') {
  const B = SHEET;
  const shop = (() => { const L = canvas2d(), g = L.g, r = rng(3); g.fillStyle = '#17120e'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '90,70,50'},${0.05 + r() * 0.1})`; g.fillRect(r() * W, r() * H, 2 + r() * 40, 1 + r() * 3); }
    g.fillStyle = '#231b14'; g.fillRect(0, 1720, W, 200); g.getImageData(0, 0, 1, 1); return L.cv; })();
  draw = t => { ctx.drawImage(shop, 0, 0); B.hung(ctx, 40, 150, { sag: 12, sway: 3 * Math.sin((t - hit) * 2) });
    const gr = ctx.createRadialGradient(W * 0.6, H * 0.12, 250, W * 0.5, H * 0.45, 1500); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(12,8,4,0.62)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.3 }); };
  card = t => ({ l1cap: B.blocks.l1.cap, l2cap: B.blocks.l2.cap, audit: [audit(B.blocks.l1, 1, { dx: 40, dy: 150 }), audit(B.blocks.l2, 1, { dx: 40, dy: 150 })] });
}
if (DEMO === 'fxtest') {     // the cheap-effect detector against known cases (TYPE c2 gate spec 4)
  const cases = ['CLEAN', 'GLOW', 'SHADOW', 'KEYLINE', 'HALO'].map((k, i) => ({ k, b: setBlock(F.anton, [{ text: k, cap: 170 }], { y: 330 + i * 330 }) }));
  draw = () => { ctx.fillStyle = '#e9e0cc'; ctx.fillRect(0, 0, W, H);
    for (const { k, b } of cases) for (const G of b.glyphs) { ctx.save(); ctx.translate(G.ox, G.oy);
      if (k === 'GLOW') { ctx.shadowColor = 'rgba(255,120,40,0.95)'; ctx.shadowBlur = 26; }
      if (k === 'SHADOW') { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowOffsetX = 9; ctx.shadowOffsetY = 9; ctx.shadowBlur = 3; }
      if (k === 'KEYLINE') { ctx.lineWidth = 8; ctx.strokeStyle = '#c91f37'; ctx.stroke(G.path); }
      if (k === 'HALO') { ctx.lineWidth = 12; ctx.strokeStyle = '#fffaf0'; ctx.lineJoin = 'round'; ctx.stroke(G.path); }
      ctx.fillStyle = '#16120f'; ctx.fill(G.path); ctx.restore(); } };
  card = () => Object.fromEntries(cases.map(({ k, b }) => [k, cheapEffects(ctx, b)]));
}
function audit(block, read, o = {}) { typeAudit.reset(); typeAudit.add(block, { read, ...o }); return typeAudit.items[0]; }

window.renderFrame = t => { ctx.save(); draw(t); ctx.restore(); };
window.typeC2 = t => card(t);
window.typeInfo = () => typeAudit.items;
window.renderFrame(typeof hit === 'number' ? hit + 0.5 : hit[0]);
ready = true;
