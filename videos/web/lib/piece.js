// PIECE: one heat video from data. words = [[beat, text|null]], shots = [[beat, field, pal, riders?, hz?]].
// drops/darks = [[fromBeat, toBeat]]; sigilAt / endAt in beats. Everything else is house style.
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, Finish, sigil, closer, outCanvas, hud } from './kit.js';
import { Heat, FIELD, PAL, sliceGlitch, punch, scaleBar, riders } from './heat.js';
export { FIELD, PAL };

const PN = ['ironbow', 'infrared', 'rainbow', 'ice', 'infrared'];
const at = (list, beat) => { let r = list[0]; for (const x of list) if (beat >= x[0]) r = x; return r; };
const inAny = (ranges, b) => ranges.some(([a, z]) => b >= a && b < z);

export async function piece({ song, words, shots, hot = [], big = [], drops = [], darks = [], sigilAt, endAt, flashes = [],
  label = 'CLASS', tempo = [36.6, 18], seed = 7, textY = 1540, extra = null, hudUntil = null }) {
  const ctx = outCanvas();
  await loadFonts();
  const B = await loadBeats(song);
  const logo = await loadImage('../assets/acp_logo_dark.png');
  const finish = new Finish(seed);
  const heat = new Heat(0.5);
  const HOT = new Set(hot), BIG = new Set(big);
  hudUntil = hudUntil ?? sigilAt;
  window.renderFrame = async (t) => {
    const beat = B.beat(t), frame = Math.round(t * 30);
    if (beat >= endAt) { closer(ctx, (beat - endAt) * B.spb); finish.apply(ctx, frame, { grain: 0.06, vignette: 0.6 }); return; }
    const kick = Math.max(B.env('kick', t, 10), 0.8 * B.env('taiko', t, 9)), imp = B.env('impact', t, 5), shout = B.env('shout', t, 12);
    const [s0, field, pal, dens = 0, hz = 0, auxf = 0] = at(shots, beat);
    const aux = typeof auxf === 'function' ? auxf(beat - s0, beat) : auxf;
    const age = beat - s0;
    const drop = inAny(drops, beat);
    const dr = darks.find(([a, z]) => beat >= a && beat < z);
    const dark = dr ? clamp((beat - dr[0]) / 2.5) * (1 - clamp((beat - (dr[1] - 1)) / 1)) : 0;
    const zoom = 1 + 0.09 * kick + 0.22 * imp + age * 0.035 + (field === FIELD.tunnel ? age * 0.1 : 0);
    heat.draw(ctx, t * (1 - 0.85 * dark), { field, pal, kick: kick * (1 - dark), zoom, hz, aux,
      freeze: dark * 0.8, hot: dark ? -0.5 * dark : field === FIELD.corridor ? -0.2 : drop ? 0.06 + 0.12 * shout : 0,
      split: 0.003 + 0.016 * kick + (drop ? 0.006 : 0), warp: drop ? 1.25 : 1, seed: s0 * 1.13 + seed,
      melt: drop ? 0.03 + 0.05 * kick : 0, rot: drop ? Math.sin(beat * 1.1) * 0.02 : 0 });
    if (dens) riders(ctx, B, t, dens, pal !== PAL.infrared, H * (1 - (-0.2 + hz) * zoom) / 2, s0);
    if (extra) extra(ctx, t, beat, { kick, imp, drop, dark, field, pal, age });
    if (beat < hudUntil) {
      const temp = tempo[0] + beat * tempo[1] + kick * tempo[1];
      hud(ctx, t, dark ? lerp(temp, -40, dark) : temp, W / 2 + Math.sin(t * 1.7) * 200, 700 + Math.cos(t * 1.1) * 180,
        dark > 0.5 ? 'IDLE' : label, dark > 0.5 ? '#dff4ff' : '#fff');
      scaleBar(ctx, dark > 0.5 ? 'ice' : PN[pal], dark > 0.5 ? '0°' : `${Math.round(tempo[0] + beat * tempo[1])}°`, `${Math.round(tempo[0])}°`);
    }
    if (beat >= sigilAt) {
      const u = ease.outExpo(clamp((beat - sigilAt) / 1));
      sigil(ctx, W / 2, 820, 210 * lerp(1.7, 1, u) * (1 + 0.07 * kick), { color: C.cream, alpha: u, tagline: true });
    }
    const cut = age < 0.3 ? 1 - age / 0.3 : 0;
    sliceGlitch(ctx, (drop ? 0.4 : 0.15) * kick + 0.8 * cut * (beat >= 4 ? 1 : 0.2) + 0.4 * imp, frame * 11 + seed, drop ? 12 : 6);
    const w = at(words, beat);
    if (w[1] && beat >= w[0]) {
      const bg = BIG.has(w[1]);
      punch(ctx, w[1], (beat - w[0]) * B.spb, { y: bg ? 1020 : textY, size: bg ? 430 : HOT.has(w[1]) ? 270 : 230,
        color: dark > 0.5 ? '#e8f7ff' : HOT.has(w[1]) || bg ? '#ffffff' : C.cream, jitter: drop ? 1 : 0.3, seed: w[0] * 3 + seed });
    }
    ctx.globalAlpha = 0.9; ctx.drawImage(logo, 40, H - 160, 96, 96); ctx.globalAlpha = 1;
    const flash = flashes.reduce((f, b) => f + (beat >= b && beat < b + 0.25 ? 0.85 - (beat - b) * 3.4 : 0), 0);
    finish.apply(ctx, frame, { grain: 0.1, vignette: 0.75, flash });
  };
  window.sceneReady = true;
}
