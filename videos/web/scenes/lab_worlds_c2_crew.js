// LAB WORLDS c2 / CREW: the plant with its crew (HUMAN c3 folk_worlds KITS.plant) over the WORLDS c2 plant plate (lab_worlds_c2
// ?shot=plantplate: the hero stack and cooling-tower plume lit from below, no river). The event: the tap flare opens up on the
// hit, cross-fading the flare light layer baked into the plate and keying the men from the world side.
//   ?hit=1.0   renderFrame(t, { look: 'raw' | 'NOTAN' | 'THERMAL' })   (THERMAL loads with &thermal=1)
import * as THREE from 'three';
import { Stage, KITS, thermalLUT } from '../lib/fx/folk_worlds.js';
import { Looks } from '../lib/fx/looks.js';
import { strikeEnvelope } from '../lib/fx/relight.js';

const Q = new URLSearchParams(location.search), HIT = +(Q.get('hit') ?? 1.0), THERM = !!Q.get('thermal');
const INFO = { shot: 'plant_crew', timings: [], card: { piece: 'COMMON WEALTH / PRODUCTIVE', word: 'STEELWORKERS.', event: 'the tap flare opens up and keys the faces from the world side', hit: 'song 6.00 s (STEELWORKERS.)',
  values: 'crew = lower 2/3 (dark masses, lit edges); the plume column lit from below = the one lit mass above them; sky held down', looks: ['raw', 'NOTAN', 'THERMAL'], planes: 'crew 2-8 m | catwalk | plant 700-1500 m | Hades rows' } };
window.shotInfo = () => INFO;
const out = Object.assign(document.createElement('canvas'), { width: 1080, height: 1920, id: 'out' }); out.style.width = '1080px'; out.style.height = '1920px'; document.body.appendChild(out);
const ctx = out.getContext('2d');
try { const f = new FontFace('Ovp', 'url(../assets/fonts/overpass-latin-900-normal.woff2)'); document.fonts.add(await f.load()); } catch (e) {}
const st = new Stage({ W: 1080, H: 1920 }); await st.init();
const PL = (Q.get('pl') || '1.0,0,-60,1120').split(',').map(Number);
const kit = await KITS.plant(st, { thermal: THERM, plate: 'plant_c2.jpg', plateFlare: 'plant_c2_flare.jpg', plateT: 'plant_c2t.jpg', PL: { s: PL[0], dx: PL[1], dy: PL[2], horizon: PL[3] }, flareK: +(Q.get('fk') || 24) });
// the flare's envelope: it opens up on the hit (a gas flare roars, it does not flash), holds, breathes
const flareW = t => { const a = t - HIT; if (a < 0) return 0.06 * (1 + Math.sin(t * 9)) ; return Math.min(1, 0.55 + a * 3) * (0.9 + 0.1 * Math.sin(t * 23) * Math.sin(t * 7.3)); };
let lk = null;
// THERMAL c2: a baked heat-diffusion field: the hot bodies (faces, hands, the plume foot) diffuse warm air upward into the cold scene
function heatField(src) {
  const w = 270, h = 480, c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
  g.drawImage(src, 0, 0, w, h); const im = g.getImageData(0, 0, w, h), D = im.data; let F = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const l = (D[i * 4] * 0.5 + D[i * 4 + 1] * 0.4 + D[i * 4 + 2] * 0.1) / 255; F[i] = Math.max(0, l - 0.62) * 2.6; }
  const S = F.slice();
  for (let it = 0; it < 26; it++) { const N = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x;
      N[i] = Math.max(S[i], 0.2 * F[i] + 0.8 * (F[i - 1] + F[i + 1] + F[i + w] * 0.6 + F[i - w] * 1.4) / 4); }   // buoyant: heat rises (from below: i + w)
    F = N; }
  for (let i = 0; i < w * h; i++) { const v = Math.min(1, F[i]) * 0.55, [r, gg, b] = thermalLUT(0.35 + v * 0.4); D[i * 4] = r; D[i * 4 + 1] = gg; D[i * 4 + 2] = b; D[i * 4 + 3] = Math.round(255 * Math.min(1, v * 1.3)); }
  g.putImageData(im, 0, 0); return c;
}
function word(g, t, ink) { if (t < HIT - 1e-4) return; g.save(); g.font = '900 116px Ovp'; g.textAlign = 'center'; g.translate(540, 0.17 * 1920); g.scale(0.84, 1); g.fillStyle = ink; g.fillText('STEELWORKERS.', 0, 0); g.restore(); }
window.renderFrame = (t, o = {}) => {
  const look = o.look || 'raw', t0 = performance.now();
  kit.flare = THERM ? 0 : flareW(t);
  const fr = kit.frame(t);
  if (look === 'THERMAL') { ctx.drawImage(fr.color, 0, 0); const hf = heatField(fr.color); ctx.save(); ctx.globalCompositeOperation = 'lighten'; ctx.drawImage(hf, 0, 0, 1080, 1920); ctx.restore(); word(ctx, t, '#f4f0e8'); }
  else if (look === 'raw') { ctx.drawImage(fr.color, 0, 0); word(ctx, t, '#efe7d6'); }
  else { lk ||= new Looks(); lk.source({ color: fr.color, aux: fr.aux, depth: [1, Math.E ** 4], tonal: ['subject', 'mid'], rankCut: false }, {}); lk.apply(ctx, look, t, { imp: Looks.impactFrame(t, HIT, 2) }); word(ctx, t, '#f1e9d8'); }
  INFO.timings.push(Math.round(performance.now() - t0)); INFO.stats = { frameMs: Math.round(performance.now() - t0), flare: +kit.flare.toFixed(2), ...(fr.info || {}) };
};
window.__lab = { st, kit };
window.renderFrame(0);
window.sceneReady = true;
