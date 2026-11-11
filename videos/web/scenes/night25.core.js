// THE NIGHT OF 25 OCTOBER: the frame (scenes/night25.js makes the canvases and the glow and calls this; web/labs/nightprint/night25_dry.mjs builds
// it in node against stubs and runs every frame's logic). The plan is night25.plan.js; the hands night25.hands.js.
// Each frame: the plate (reel.js) composed where the plan places it -> the night print (lib/fx/nightprint.js, eased in v2) -> the words, then
// the hands over them on the type layer -> post.js's glow (held down in v2) -> the mark. v2: no eyes are drawn (night25.plan.js header).
import { W, H, loadFonts, closer, clamp } from '../lib/kit.js';
import { loadBands, band, STYLES } from '../lib/fx/bands.js';
import { Reel } from '../lib/fx/reel.js';
import { NightPrint } from '../lib/fx/nightprint.js';
import * as P from './night25.plan.js';
import { drawHands } from './night25.hands.js';

const strikeOf = age => { const fr = age * 30; return fr < 3 ? 1.16 - 0.16 * fr / 3 : fr < 5 ? 1 - 0.03 * Math.sin((fr - 3) / 2 * Math.PI) : 1; };   // bands.js's own strike
// bands.js's cueType, line for line, with the band fitted to the plan's width (cueType has no width; band() takes maxW)
function cues(g, now, list, x, maxW) {
  for (const [a, e, lines, y, size, style] of list) {
    if (now < a || now >= e) continue;
    const al = clamp((e - now) / 0.08), strike = style === 'sub' ? 1 : strikeOf(now - a);
    lines.forEach((tx, i) => band(g, tx, x, y + i * size * 1.22, size, { ...STYLES[style || 'main'], a: al, strike, maxW }));
  }
}

// the Dial's face, v3: the crowd under the hands was muddy because nothing said it was a clock. Outside the ring the night is put back (the plate
// is a disc), the ring and twelve hour marks are drawn on the type layer in the hands' own cream, so the masses are what the clock is made of.
function dialScrim(g, A, a) {
  const gr = g.createRadialGradient(A.x, A.y, A.R * 0.92, A.x, A.y, A.R * 1.06);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${0.94 * a})`); g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
function dialRing(g, A, a) {
  g.save(); g.globalAlpha = a; g.strokeStyle = '#EFE6CF'; g.lineCap = 'round';
  g.lineWidth = 5; g.beginPath(); g.arc(A.x, A.y, A.R * 1.0, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.globalAlpha = a * 0.6; g.beginPath(); g.arc(A.x, A.y, A.R * 0.9, 0, Math.PI * 2); g.stroke(); g.globalAlpha = a;
  for (let h = 0; h < 12; h++) {
    const th = h * Math.PI / 6, big = h % 3 === 0, r0 = A.R * (big ? 0.84 : 0.88), r1 = A.R * 0.985;
    g.lineWidth = big ? 11 : 6; g.beginPath(); g.moveTo(A.x + r0 * Math.sin(th), A.y - r0 * Math.cos(th)); g.lineTo(A.x + r1 * Math.sin(th), A.y - r1 * Math.cos(th)); g.stroke();
  }
  g.restore();
}

export async function buildNight25({ post, take = 'a', canvas = () => document.createElement('canvas') }) {
  await loadFonts(); await loadBands();
  P.setTake(take);
  const [reel, cfg] = await Promise.all([Reel.load('../assets/night25/plates'), fetch('../assets/night25/reel.json').then(r => r.json())]);
  P.setShots(cfg.shots);
  const missing = [...new Set(P.CUT_LIST.map(c => c[1]).filter(Boolean))].filter(s => !reel.idx[s]);
  // the room's plates come from a farm render of night25_room (night25.plan.js); until they are cut, a draft of the 1917 night draws
  // those cuts black with the hands and words (said in the console). Any other missing plate is an error.
  const missingNow = missing.filter(s => s.startsWith('n25_now_')), missingOld = missing.filter(s => !s.startsWith('n25_now_'));
  if (missingOld.length) throw new Error('night25: plates missing from assets/night25/plates/index.json: ' + missingOld.join(', '));
  if (missingNow.length) console.warn('night25 DRAFT: the room plates are not cut yet, drawn black: ' + missingNow.join(', '));
  const mk = () => { const c = canvas(); c.width = W; c.height = H; return c; };
  const plateCv = mk(), pg = plateCv.getContext('2d'), worldCv = mk(), wg = worldCv.getContext('2d'), typeCv = mk(), tg = typeCv.getContext('2d');
  const closerCv = mk(), closerG = closerCv.getContext('2d');
  const np = new NightPrint(W, H, { canvas: mk() });
  const nOf = s => reel.n(s);
  // take c: the room drawn live (night25.room.js: the person pipeline, one bulb), in colour, instead of v2's grey plates (the plates stay take a's)
  let room = null; const roomCv = mk();
  if (take === 'c') room = await (await import('./night25.room.js')).buildRoom({ canvas: roomCv, quality: 'film' });
  const ROOM_AT = { n25_now_wide: [0, 1.0, 5.0], n25_now_a: [1, 1.0, 4.0], n25_now_b: [2, 1.0, 4.0], n25_now_c: [3, 1.0, 4.0], n25_now_low: [4, 0.1, 3.0], n25_now_high: [5, 1.0, 4.0] };
  const stats = { prints: 0, hands: 0 };

  async function frame(t) {
    const tt = Math.min(t, P.TL.mark - 1e-3);
    wg.globalAlpha = 1; wg.globalCompositeOperation = 'source-over'; wg.fillStyle = '#000'; wg.fillRect(0, 0, W, H);
    // ---------------------------------------------------------------- the plate, printed (no plate: the held breath at 2:00, black)
    const c = P.cutAt(tt);
    const fadeOut = 1 - 0.85 * P.sstep(P.TL.mark - 1.6, P.TL.mark, t);
    if (room && c && c.shot && ROOM_AT[c.shot]) {
      const [si, s0, len] = ROOM_AT[c.shot], u = s0 + Math.min(len, c.o.off + c.age * c.o.rate), z = c.z;
      await room.renderShot(si, u, tt);
      // the present is the one colour in the piece: the room's own light (a 2700 K bulb), the blacks held, a little less than full chroma
      wg.globalAlpha = fadeOut; wg.filter = 'contrast(1.12) saturate(0.88) brightness(0.96)';
      wg.drawImage(roomCv, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z); wg.filter = 'none'; wg.globalAlpha = 1; stats.prints++;
    } else if (c && c.shot && reel.idx[c.shot]) {
      const n = reel.n(c.shot), f = P.plateFrame(c, n, reel.idx[c.shot]?.fps || 24), place = P.placeOf(c);
      pg.fillStyle = '#000'; pg.fillRect(0, 0, W, H);
      await reel.drawShot(pg, c.shot, f, { z: c.z, cy: place.cy, ...c.rect });
      const o = { ...P.printAt(c, tt), place, boil: 12, grain: 0.03 };
      if (c.shot === 'n25_iris') o.iris = P.irisPrint(c, cfg.shots.n25_iris.track, f);
      np.print(plateCv, tt, o);
      // the ending breathes: the last room shot sinks into the night before the mark
      wg.globalAlpha = fadeOut;
      wg.drawImage(np.canvas, 0, 0, W, H); wg.globalAlpha = 1; stats.prints++;
    }
    // ---------------------------------------------------------------- v3: the Dial's face (night under the ring, so the crowd reads as a clock), and the scrims under the words
    const dialOn = !!(c && c.o.dial && t < P.TL.mark), dA = dialOn ? P.anchorAt(tt, nOf) : null, dAlpha = dialOn ? P.handsAlpha(tt) : 0;
    if (dialOn && dAlpha > 0.002) dialScrim(wg, dA, dAlpha);
    if (t < P.TL.mark) for (const [a, e, y0, y1, al] of P.SCRIMS) {
      const k = P.sstep(a, a + 0.3, tt) * (1 - P.sstep(e - 0.3, e, tt)); if (k <= 0.002) continue;
      const gr = wg.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.3, `rgba(0,0,0,${al * k})`); gr.addColorStop(0.7, `rgba(0,0,0,${al * k})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      wg.fillStyle = gr; wg.fillRect(0, y0, W, y1 - y0);
    }
    // ---------------------------------------------------------------- the words and the hands (the type layer: no glow, never torn)
    tg.clearRect(0, 0, W, H);
    if (t < P.TL.mark) {
      cues(tg, tt, P.CUES, P.CX, P.TYPE_MAXW);
      for (const [a, e, line, y, size] of P.SUBS) if (tt >= a && tt < e) band(tg, line, P.CX, y, size, { ...STYLES.sub, a: clamp((e - tt) / 0.08), maxW: P.TYPE_MAXW });
      if (dialOn && dAlpha > 0.002) dialRing(tg, dA, dAlpha);
      const A = P.anchorAt(tt, nOf), L = P.handLen(A.R, !!A.big), hh = P.handsAt(tt), sw = P.handsSweep(tt);
      drawHands(tg, { x: A.x, y: A.y, minute: L.minute, hour: L.hour, width: L.width, aHour: hh.hour, aMin: hh.minute, sweepHour: sw.hour, sweepMin: sw.minute,
        alpha: P.handsAlpha(tt) * (1 - 0.7 * P.sstep(P.TL.mark - 1.6, P.TL.mark, t)) });
      stats.hands++;
    } else {
      // the mark: the closer screened over the night
      const age = t - P.TL.mark;
      wg.fillStyle = `rgba(2,1,1,${clamp(0.85 + age * 3, 0, 0.97)})`; wg.fillRect(0, 0, W, H);
      closerG.clearRect(0, 0, W, H); closer(closerG, age);
      wg.save(); wg.globalCompositeOperation = 'screen'; wg.drawImage(closerCv, 0, 0); wg.restore();
    }
    post.apply({ world: worldCv, type: typeCv }, t, P.look(t));
    return {};
  }
  return { frame, np, reel, cfg, stats, canvases: { plateCv, worldCv, typeCv } };
}
