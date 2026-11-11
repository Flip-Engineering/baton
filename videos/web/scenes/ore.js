// ORE TO ORBIT (7 Oct 2026, new piece; IDEAS_BANK §5 #5). One chain of work from a pit in the ground to a rocket leaving the Earth, and every
// link a worker: the miner, the railroader, the dockworker, the sailor, the unloader, the furnace crew, the steelworker ... and it leaves the Earth.
// The film is the record itself: Steel: Man's Servant (1938, three-strip Technicolor; NFPF, Public Domain Mark) and the National Archives' reel of
// Apollo 11's launch (16 Jul 1969, 255-S-4655, a US government work). Never labelled. Each cut arrives as Technicolor did, plate by plate, and
// snaps into register on the beat (repro.js threestrip). Between the links the route runs across the US map (geo/usmap 'poster'): Mesabi Range ->
// Duluth -> the Lakes -> Gary -> Huntsville -> Cape Canaveral. The places are real places of that work; the piece does not claim this ore became
// that rocket (the Saturn V was mostly aluminum): the chain is the class's, link by link.
// Built on the shared studio modules: lib/fx/reel.js (plates; scripts/reelbake.py + assets/ore/reel.json), lib/fx/bands.js (the house type),
// repro.js threestrip, maps.js USMap + mapkit labels.  Score: songs2/ore_e.py, 120 BPM (a beat is 0.5 s).
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease } from '../lib/kit.js';
import { Reel } from '../lib/fx/reel.js';
import { Repro } from '../lib/fx/repro.js';
import { loadBands, cueType, HRED, STOCK, INK, FONT } from '../lib/fx/bands.js';
import { loadGeo, USMap } from '../lib/fx/maps.js';
import { camApply } from '../lib/fx/geo/data.js';
import { Print } from '../lib/fx/print.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts(); await loadBands();
const finish = new Finish(1938);
const BT = b => b * 0.5;

// beats
export const TL = { rock: 0, miners: 4, mapA: 12, rail: 14, dock: 18, sail: 21, mapB: 24, unload: 27, furnace: 30, steel: 39, mapC: 47, launch: 51,
  links: 63, chain: 71, own: 76, payoff: 81, mark: 86, end: 94 };

// ------------------------------------------------------------------ the film
const reel = await Reel.load('../assets/ore/plates');
const CUTS = Reel.cuts([
  [0, 'shovel', { z: [1.02, 1.1] }], [TL.miners, 'shovelop', { z: [1.02, 1.08], rate: 0.8 }], [6, 'bucket'], [8, 'dump'], [10, 'pit', { rate: 0.8 }],
  [TL.rail, 'engineer', { rate: 0.8 }], [16, 'oretrain'], [TL.dock, 'chutes'], [TL.sail, 'boat', { rate: 0.8 }],
  [TL.unload, 'hulettop', { rate: 0.8 }], [28.5, 'hulett'],
  [TL.furnace, 'cast'], [32, 'caster'], [34, 'tap'], [36, 'tapman', { rate: 0.8 }], [37.5, 'crew'],
  [TL.steel, 'soak'], [41, 'ingot'], [43, 'rolls'], [45, 'phone', { rate: 0.8 }],
  [TL.launch, 'launch', { z: [1.0, 1.06], rate: 1 }], [59, 'liftoff', { z: [1.02, 1.08] }],
  // every link a worker: their faces, a beat each
  [TL.links, 'shovelop', { off: 0.3, z: [1.06, 1.1], rate: 0.6 }], [64, 'engineer', { off: 0.6, rate: 0.6 }], [65, 'hulettop', { off: 0.6, rate: 0.6 }],
  [66, 'caster', { off: 0.6, rate: 0.6 }], [67, 'tapman', { off: 0.8, rate: 0.6 }], [68, 'phone', { off: 0.8, rate: 0.6 }], [69, 'crew', { off: 0.8, rate: 0.6 }],
  [70, 'bench', { z: [1.02, 1.1], rate: 0.6 }],
  [TL.own, 'tap', { off: 0.5, z: [1.04, 1.1] }], [TL.payoff, 'climb', { z: [1.0, 1.08] }],
], BT, BT(TL.mark));
const MAPS = [[TL.mapA, TL.rail, 0, 1], [TL.mapB, TL.unload, 1, 3], [TL.mapC, TL.launch, 3, 5], [TL.chain, TL.own, 5, 5]];   // the chain: every leg already inked   // [from, to, first leg, last leg]
const inMap = b => MAPS.find(([a, e]) => b >= a && b < e);

const SRC = Object.assign(document.createElement('canvas'), { width: W, height: H }), SG = SRC.getContext('2d');
const RP = new Repro(W, H);
// the register snap: each cut's plates come in misregistered and lock on the cut's beat. The opening arrives plate by plate.
function register(b, cutBeat) {
  const quick = cutBeat >= TL.links && cutBeat < TL.chain;                    // the faces: one a beat, so a smaller, faster snap
  const a = BT(b - cutBeat), k = (quick ? 0.45 : 1) * (1 - ease.outCubic(clamp(a / (quick ? 0.1 : 0.22))));
  const reg = [[34 * k, -6 * k], [-26 * k, 14 * k], [6 * k, -30 * k]];
  let plates = [1, 1, 1];
  if (cutBeat === 0) plates = [clamp((b - 1.0) / 0.25), clamp((b - 0.5) / 0.25), clamp(b / 0.25)];        // yellow, then magenta, then cyan
  return { reg, plates };
}
async function film(g, b) {
  const t = BT(b); SG.fillStyle = '#000'; SG.fillRect(0, 0, W, H);
  const r = await reel.draw(SG, t, CUTS, { ease: ease.inOutSine || (x => x) }); if (!r) return null;
  const cb = r.cut.t / 0.5, R = register(b, cb);
  RP.threestrip(SRC, t, { reg: R.reg, plates: R.plates, sat: 1.12, curve: 0.3, grain: 0.7 }); RP.draw(g);
  return r;
}

// ------------------------------------------------------------------ the route
const geo = await loadGeo({ world: false, rivers: false });
const us = new USMap(geo); us._bake(); us.plate({ Print, paper: 'cream' });           // the engraved relief on cream stock
const STOPS = [['MESABI RANGE', [-92.94, 47.43]], ['DULUTH', [-92.10, 46.78]], ['GARY', [-87.35, 41.60]], ['HUNTSVILLE', [-86.59, 34.73]], ['CAPE CANAVERAL', [-80.60, 28.57]]];
// the legs as lon/lat polylines (the boat's leg runs the Lakes: across Superior, the Soo, the Straits, down Lake Michigan)
const LEGS = [
  [[-92.94, 47.43], [-92.10, 46.78]],
  [[-92.10, 46.78], [-89.6, 47.1], [-86.6, 46.9], [-84.6, 46.55]],
  [[-84.6, 46.55], [-84.75, 45.82], [-86.3, 45.2], [-87.0, 43.5], [-87.35, 41.60]],
  [[-87.35, 41.60], [-86.9, 38.5], [-86.59, 34.73]],
  [[-86.59, 34.73], [-84.0, 31.6], [-80.60, 28.57]],
].map(L => L.map(p => us.project(p)));
const legLen = L => { let s = 0; for (let i = 1; i < L.length; i++) s += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); return s; };
function partial(L, u) { const tot = legLen(L) * u, out = [L[0]]; let s = 0;
  for (let i = 1; i < L.length; i++) { const d = Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); if (s + d >= tot) { const k = (tot - s) / d; out.push([lerp(L[i - 1][0], L[i][0], k), lerp(L[i - 1][1], L[i][1], k)]); return out; } s += d; out.push(L[i]); }
  return out; }
const bbox = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const MAPC = document.createElement('canvas'); MAPC.width = W; MAPC.height = H; const MG = MAPC.getContext('2d');
function drawMap(g, b, [a, e, l0, l1]) {
  const u = clamp((b - a - 0.3) / (e - a - 0.9)), drawn = ease.inOutSine ? ease.inOutSine(u) : u;
  const pts = (l1 > l0 ? LEGS.slice(l0, l1) : LEGS).flat(), bx = bbox(pts), cx = (bx[0] + bx[2]) / 2, cy = (bx[1] + bx[3]) / 2;
  const span = Math.max((bx[2] - bx[0]) / 820, (bx[3] - bx[1]) / 1100, 0.06), z0 = 1 / span;
  const cam = { x: cx, y: cy, zoom: lerp(z0 * 1.12, z0, ease.outCubic(clamp((b - a) / (e - a)))), sy: 1080 };
  MG.setTransform(1, 0, 0, 1, 0, 0); MG.fillStyle = '#F4E6D0'; MG.fillRect(0, 0, W, H);
  us.draw(MG, { cam, t: BT(b), style: 'engraving', grid: 0.2, borders: 0.7, embers: false, res: 0.8 });
  // the route: the legs before this map already inked; this map's legs drawn as the beat runs
  MG.save(); const z = camApply(MG, cam); MG.lineCap = 'round'; MG.lineJoin = 'round';
  const nLegs = l1 - l0;
  for (let i = 0; i < l1; i++) {
    let L = LEGS[i];
    if (i >= l0 && nLegs > 0) { const k = clamp(drawn * nLegs - (i - l0)); if (k <= 0) continue; L = partial(L, k); }
    MG.strokeStyle = 'rgba(11,11,11,0.85)'; MG.lineWidth = 20 / z; MG.beginPath(); L.forEach((p, j) => j ? MG.lineTo(p[0], p[1]) : MG.moveTo(p[0], p[1])); MG.stroke();
    MG.strokeStyle = STOCK; MG.lineWidth = 11 / z; MG.stroke();
    if (nLegs > 0 && i >= l0 && drawn * nLegs - (i - l0) < 1) { const p = L[L.length - 1]; MG.fillStyle = INK; MG.beginPath(); MG.arc(p[0], p[1], 20 / z, 0, Math.PI * 2); MG.fill(); MG.fillStyle = STOCK; MG.beginPath(); MG.arc(p[0], p[1], 11 / z, 0, Math.PI * 2); MG.fill(); }
  }
  MG.restore();
  // the stops reached so far: a mark and a name
  for (let i = 0; i < STOPS.length; i++) {
    const legDone = i === 0 ? l0 > 0 || drawn > 0 : (i <= l0 || drawn * nLegs >= i - l0); if (!legDone || i > l1) continue;
    const [x, y] = us.toScreen(us.project(STOPS[i][1]), cam); if (x < -50 || x > W + 50 || y < 200 || y > H - 80) continue;
    MG.fillStyle = INK; MG.beginPath(); MG.arc(x, y, 11, 0, Math.PI * 2); MG.fill(); MG.fillStyle = STOCK; MG.beginPath(); MG.arc(x, y, 5, 0, Math.PI * 2); MG.fill();
    MG.font = `900 62px ${FONT}`; MG.textAlign = x > W - 300 ? 'right' : 'left'; MG.lineWidth = 9; MG.strokeStyle = '#F4E6D0'; const tx = x + (x > W - 300 ? -22 : 22);
    MG.strokeText(STOPS[i][0], tx, y + 16); MG.fillStyle = INK; MG.fillText(STOPS[i][0], tx, y + 16);
  }
  g.drawImage(MAPC, 0, 0);
}

// ------------------------------------------------------------------ the words
const CUES = [
  [0.4, TL.miners, ['IT STARTS', 'AS ROCK.'], 300, 160, 'main'],
  [TL.miners, TL.mapA, ['MINERS', 'DIG IT.'], 300, 160, 'main'],
  [TL.rail, TL.dock, ['RAILROADERS', 'HAUL IT.'], 300, 150, 'main'],
  [TL.dock, TL.sail, ['DOCKWORKERS', 'LOAD IT.'], 300, 150, 'main'],
  [TL.sail, TL.mapB, ['SAILORS', 'SHIP IT.'], 300, 160, 'main'],
  [TL.unload, TL.furnace, ['UNLOADERS', 'LIFT IT OUT.'], 300, 150, 'main'],
  [TL.furnace, TL.steel, ['FURNACE CREWS', 'MELT IT.'], 300, 150, 'main'],
  [TL.steel, TL.mapC, ['STEELWORKERS', 'ROLL IT.'], 300, 150, 'main'],
  [TL.mapC + 0.2, TL.launch, ['MACHINISTS, WELDERS', 'AND ENGINEERS', 'BUILD WITH IT.'], 230, 104, 'main'],
  [TL.launch + 4, TL.links, ['AND IT LEAVES', 'THE EARTH.'], 300, 150, 'hot'],
  [TL.links, TL.chain, ['EVERY LINK', 'IS A WORKER.'], 300, 150, 'main'],
  [TL.chain, TL.own, ['THE WHOLE CHAIN', 'IS BUILT BY', 'ONE CLASS.'], 230, 124, 'main'],
  [TL.own, TL.payoff, ['WHOEVER BUILDS IT', 'SHOULD OWN IT.'], 300, 124, 'hot'],
  [TL.payoff + 0.3, TL.mark - 0.1, ['ORE TO ORBIT.'], 300, 170, 'red'],
];

// ------------------------------------------------------------------ the frame
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setTransform(1, 0, 0, 1, 0, 0);
  const b = t / 0.5;
  if (b >= TL.mark) { closer(ctx, t - BT(TL.mark)); return {}; }
  const m = inMap(b);
  if (m) drawMap(ctx, b, m); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); await film(ctx, b); }
  cueType(ctx, b, CUES, { toS: BT });
  finish.apply(ctx, Math.round(t * 30), { grain: 0.03, vignette: 0.26 });
  return {};
};
ready = true;
