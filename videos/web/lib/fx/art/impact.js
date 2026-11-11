// ART kit / IMPACT: two-ink impact frames with material debris. 2D canvas, pure in t.
//
//   import { impactFrame, debris } from '../lib/fx/art/impact.js';
//   impactFrame(ctx, t, { hit, inks: ['oxide', 'stock'], thr: 0.45 })   // frames 0-1 after the hit: the frame thresholded
//                                                                          // to two inks; frame 2: inverted; then gone
//   debris(ctx, t, { hit, origin: [540, 1500], kind: 'sparks'|'chips'|'toner', n: 60 })   // 4-12 frames, on twos
//
// Why: our impacts were brightness pops (NOTES §1.4). An impact frame in this house is a PRINT event: for one or two
// frames the picture collapses to the piece's two inks (the manga/anime impact frame, Guilty Gear's held hit, but
// printed), then material is thrown: sparks and slag in the furnace, chips in the woodcut, toner in the press. The
// LOOKS/TYPE judges' floor applies: mean frame change >= 0.15 and >= 1.5x the 4 neighbours, no dead frame +-12.
import { M } from './motion.js';
import { INK, heat } from './tokens.js';

const col = k => INK[k] || k;
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const S = {};
const buf = (k, w, h) => (S[k] && S[k].width === w && S[k].height === h ? S[k] : (S[k] = mk(w, h)));

export function impactFrame(ctx, t, { hit, inks = ['ink', 'stock'], thr = 0.5, frames = 2, invert = true, zoom = 0.035 } = {}) {
  const f = M.rel(t, hit); if (f < 0 || f > frames) return false;
  const W = ctx.canvas.width, H = ctx.canvas.height, [dk, lt] = f === frames && invert ? [inks[1], inks[0]] : inks;
  const src = buf('src', W, H), sg = src.getContext('2d'); sg.drawImage(ctx.canvas, 0, 0);
  // threshold: grey, crushed with contrast around thr (brightness shifts the pivot)
  const bw = buf('bw', W, H), bg = bw.getContext('2d');
  const piv = 0.5 / Math.max(0.05, thr);
  bg.filter = `grayscale(1) brightness(${piv.toFixed(3)}) contrast(30)`; bg.drawImage(src, 0, 0); bg.filter = 'none';
  // map: out = dark*(1-bw) + light*bw
  const A = buf('A', W, H), ag = A.getContext('2d'); ag.globalCompositeOperation = 'source-over'; ag.drawImage(bw, 0, 0);
  ag.globalCompositeOperation = 'multiply'; ag.fillStyle = col(lt); ag.fillRect(0, 0, W, H);
  const B = buf('B', W, H), bgg = B.getContext('2d'); bgg.globalCompositeOperation = 'source-over'; bgg.filter = 'invert(1)'; bgg.drawImage(bw, 0, 0); bgg.filter = 'none';
  bgg.globalCompositeOperation = 'multiply'; bgg.fillStyle = col(dk); bgg.fillRect(0, 0, W, H);
  ctx.save(); const z = 1 + zoom * (frames - f + 1) / (frames + 1);        // the camera takes the hit: a punch-in that settles
  ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
  ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(A, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(B, 0, 0);
  ctx.restore(); ctx.globalCompositeOperation = 'source-over';
  return true;
}

// thrown material: ballistic in 2D, drawn on twos; sparks cool along the heat ramp and streak; chips tumble; toner puffs
export function debris(ctx, t, { hit, origin = [540, 960], kind = 'sparks', n = 60, speed = 1400, spread = Math.PI * 0.9, dir = -Math.PI / 2, seed = 5, g = 2600, life = 12, inkC = 'ink' } = {}) {
  const f = M.rel(t, hit); if (f < 0 || f > life) return false;
  const tt = Math.floor(f / 2) * 2 / 30; let q = seed * 7919 + 17; const r = () => { q = (q * 16807) % 2147483647; return q / 2147483647; };
  ctx.save();
  for (let i = 0; i < n; i++) {
    const a = dir + (r() - 0.5) * spread, v = speed * (0.25 + 0.75 * r() * r()), sz = 1 + r() * 4, ph = r();
    const x = origin[0] + Math.cos(a) * v * tt, y = origin[1] + Math.sin(a) * v * tt + 0.5 * g * tt * tt;
    if (kind === 'sparks') {
      const T = 2100 - (tt / 0.4) * 900 * (0.6 + ph); if (T < 900) continue;
      const vx = Math.cos(a) * v, vy = Math.sin(a) * v + g * tt, L = 0.022;            // streak = velocity x shutter
      ctx.strokeStyle = heat(T); ctx.lineWidth = sz * 0.7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - vx * L, y - vy * L); ctx.lineTo(x, y); ctx.stroke();
    } else if (kind === 'chips') {                     // woodcut/steel chips: dark triangles that tumble
      ctx.fillStyle = col(inkC); const s = sz * 3, rot = ph * 6 + tt * 20 * (r() - 0.5);
      ctx.beginPath(); for (let k = 0; k < 3; k++) { const aa = rot + k * 2.1 + r() * 0.5; ctx.lineTo(x + Math.cos(aa) * s, y + Math.sin(aa) * s); } ctx.fill();
    } else {                                            // toner / ink: drops that elongate along the flight
      ctx.fillStyle = col(inkC); const vy = Math.sin(a) * v + g * tt, ang = Math.atan2(vy, Math.cos(a) * v);
      ctx.beginPath(); ctx.ellipse(x, y, sz * (1 + tt * 3), sz * 0.8, ang, 0, 7); ctx.fill();
    }
  }
  ctx.restore(); return true;
}
