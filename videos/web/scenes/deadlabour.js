// DEAD LABOUR v3 (15 Oct 2026; ACP OCTOBER ep. 2; v1's concept and pictures, at speed, with THE DEPOSIT; see deadlabour.plan.js for the shots). v2's header: "Capital is dead labour, that, vampire-like, only lives by sucking living
// labour, and lives the more, the more labour it sucks" (Capital I, ch. 10, l.35). A night downtown. At the head of its avenue stands THE
// DEPOSIT (scenes/deadlabour.world.js): a pale mass taller than every tower, made of nothing but the city's congealed night-shift light, the
// dead windows set inside it. Threads of light run from the windows of the city into its crown; the near windows go cold, building by
// building; the crown swells glossy and beads run down it and set pale. Close on its flank: the windows inside the stone, under Marx's
// vampire, "so long as there is a muscle, a nerve, a drop of blood to be exploited". Then people come out of the side streets and fill the
// plaza at its foot; the labourers put their heads together and, as a class, compel the passing of a law: the threads stop, and run the
// other way, out over their heads to the city; the crown drains; the city's windows come back on one building at a time. The Party's aim
// (the Program, l.73). At the end the city's light shines through the drained deposit and lights the dead windows inside it warm, under
// Marx's line on the time that is the worker's own.
//
// Takes (each its own page, the same scene; ?take= or the page's DL_TAKE): 'a' opens down the avenue (frame 0) and ends over the city;
// 'b' opens close on the crown and pulls back down the avenue, and ends at street level looking back at the deposit.
// Modules: deadlabour.plan.js (pure: the timeline, the words, the deposit's form, the city, the flows, the crowd, the cameras),
// .world.js (World, Atmos, LightField, Skyline, the deposit, the siphon, the windows), .crowd.js (the class). 60 BPM: beats = seconds.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp } from '../lib/kit.js';
import { loadBands, band, STYLES } from '../lib/fx/bands.js';
import { loadAnsur } from '../lib/fx/rig/body.js';
import { TL, CUES, SUBS, camAt, strata } from './deadlabour.plan.js';
import { buildWorld } from './deadlabour.world.js';
import { buildCrowd } from './deadlabour.crowd.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const TAKE = (() => { try { const q = new URLSearchParams(location.search).get('take'); if (q) return q; } catch (e) { /* no page */ } return globalThis.DL_TAKE || 'c'; })();
const ctx = outCanvas();
await loadFonts(); await loadBands();
const finish = new Finish(1867);
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const CP = await fetch('../assets/deadlabour/cpgdp.json').then(r => r.json());
strata(CP);

const world = buildWorld({ take: TAKE });
const { Wd } = world, cam = Wd.camera, RH = H * Wd.scale;
const ansur = await loadAnsur();
const crowd = buildCrowd({ scene: Wd.scene, ansur, viewH: RH });

function applyCam(C) {
  cam.position.set(...C.p); cam.up.set(...C.up);
  if (cam.fov !== C.fov || cam.near !== C.near) { cam.fov = C.fov; cam.near = C.near; cam.updateProjectionMatrix(); }
  cam.lookAt(...C.l); cam.updateMatrixWorld();
}
// the words: set, not struck. Each line comes up on its own a beat after the one before (a short fade and a 10 px rise), and the card goes
// in 0.25 s; nothing scales, squashes or stamps
function words(t) {
  for (const [a, e, lines, y, size, style] of CUES) {
    if (t < a - 0.01 || t >= e) continue;
    const out = clamp((e - t) / 0.15);
    lines.forEach((tx, i) => { const t0 = a + i * 0.07, k = sstep(t0, t0 + 0.16, t); if (k <= 0) return;
      band(ctx, tx, 510, y + i * size * 1.22 + 10 * (1 - k), size, { ...STYLES[style || 'main'], a: k * out }); });
  }
  for (const [a, e, line, y, size, x] of SUBS) if (t >= a && t < e) band(ctx, line, x, y, size, { ...STYLES.sub, a: sstep(a, a + 0.3, t) * clamp((e - t) / 0.1) });
}

const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
window.__dl = { TL, world, crowd, cam, camAt, TAKE };
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  const ts = Math.min(t, TL.mark - 1e-3), C = camAt(ts, TAKE), shot = t >= TL.mark ? 'mark' : C.shot;
  applyCam(C);
  const st = world.update(ts, cam, RH);
  crowd.pose(ts, cam, shot, { held: st.held, back: st.back });
  Wd.render(null, ts); { const gl = Wd.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.drawImage(Wd.canvas, 0, 0, W, H);
  if (t >= TL.mark) {
    // the mark comes up out of the last image: the city held a moment under it, then gone
    const age = t - TL.mark; ctx.fillStyle = `rgba(3,2,2,${clamp(0.55 + age * 0.9, 0, 0.97)})`; ctx.fillRect(0, 0, W, H);
    closerG.clearRect(0, 0, W, H); closer(closerG, age); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
    finish.apply(ctx, Math.round(t * 30), { grain: 0.04, vignette: 0.3 });
    return { shot: 'mark' };
  }
  words(t);
  finish.apply(ctx, Math.round(t * 30), { grain: 0.045, vignette: 0.36 });
  return { shot, held: +st.held.toFixed(3), back: +st.back.toFixed(3) };
};
ready = true;
