// ☭≡/acc IDENT — 12-second brand sting. The ACP gear, hammer and sickle
// assembles, ≡ slams in bar by bar, /acc slashes across, then
// INTELLIGENCE / IN SERVICE / OF HUMANITY, one line per beat, and ACP.US.
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, Finish, tinted, BRAND, seq, cue, line } from '../lib/kit.js';

const ctx = document.getElementById('out').getContext('2d');
await loadFonts();
const B = await loadBeats('acc_ident');
const finish = new Finish(36);
const P = {};
for (const k of ['part_mark', 'part_eq', 'part_slash', 'part_acc']) P[k] = await loadImage(`../assets/${k}.png`);
const logo = await loadImage('../assets/acp_logo_dark.png');
const HT = 291, S = 215 / HT;                 // lockup scale: 215 px tall
const X0 = W / 2 - 1156 * S / 2, Y0 = 820 - 108;
const CUES = seq(8, [[1.5, 'INTELLIGENCE'], [1.5, 'IN SERVICE'], [1.5, 'OF HUMANITY.', 1]]);

function part(img, x, color, { dx = 0, dy = 0, a = 1, clipRows = null, rot = 0 } = {}) {
  const w = img.width * S, h = img.height * S;
  ctx.save(); ctx.globalAlpha *= a;
  ctx.translate(X0 + x * S + w / 2 + dx, Y0 + h / 2 + dy); ctx.rotate(rot);
  if (clipRows) { ctx.beginPath(); for (const [y0, y1] of clipRows) ctx.rect(-w / 2, -h / 2 + y0 * S, w, (y1 - y0) * S); ctx.clip(); }
  ctx.drawImage(tinted(img, color), -w / 2, -h / 2, w, h);
  ctx.restore();
}

window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30);
  const kick = B.env('kick', t, 9);
  // ground: black, then the banner field (red with a dark square) from beat 8
  const field = ease.outExpo(clamp((beat - 8) / 1));
  ctx.fillStyle = '#060101'; ctx.fillRect(0, 0, W, H);
  if (field > 0) {
    ctx.globalAlpha = field;
    ctx.fillStyle = '#d4101c'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, 820, 40, W / 2, 820, 620);
    g.addColorStop(0, '#3a0307'); g.addColorStop(1, '#0e0102');
    ctx.fillStyle = g; ctx.fillRect(130, 330, W - 260, 1000 * lerp(0.3, 1, field));
    ctx.fillStyle = '#d4101c'; ctx.fillRect(350, 560, 380, 440);
    ctx.globalAlpha = 1;
  }
  const cream = C.cream;
  // 0-4: the mark assembles out of a rotating sweep
  const m = clamp(beat / 3);
  if (m > 0) {
    ctx.save();
    const cx = X0 + 150 * S, cy = Y0 + 145 * S;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 400, -Math.PI / 2, -Math.PI / 2 + ease.inOutCubic(m) * Math.PI * 2); ctx.closePath(); ctx.clip();
    part(P.part_mark, 0, beat < 8 ? C.red2 : cream, { rot: (1 - ease.outCubic(m)) * -1.2 });
    ctx.restore();
  }
  // 4-7: ≡ one bar per beat from the right, then /acc slashes in
  const rows = [[101, 137], [157, 193], [213, 249]];
  rows.forEach((r, i) => {
    const u = ease.outExpo(clamp((beat - 4 - i) / 0.5));
    if (u > 0) part(P.part_eq, 300, cream, { dx: (1 - u) * 900, clipRows: [r] });
  });
  const sl = ease.outExpo(clamp((beat - 7) / 0.5));
  if (sl > 0) {
    part(P.part_slash, 520, cream, { dy: (1 - sl) * -700, a: sl });
    part(P.part_acc, 639, cream, { dx: (1 - sl) * 400, a: sl });
  }
  // 8-12.5: the tagline, one line per frame, under the mark
  cue(ctx, CUES, beat, B.spb, { y: 1260, size: 130, color: cream, red: '#ffffff', shadow: 0 });
  // 16+: the ACP sign (the tagline is said once, by the beat lines above; no second tagline strip)
  if (beat >= 16) {
    const a = clamp((beat - 16) * 2);
    ctx.globalAlpha = a;
    ctx.drawImage(tinted(logo, C.cream), W / 2 - 110, 1450, 220, 220);
    ctx.globalAlpha = 1;
    line(ctx, 'ACP.US', W / 2, 1760, { family: 'Archivo Black', size: 70, color: cream, alpha: a });
  }
  // punch on the kicks, flash on the impacts
  let flash = B.env('impact', t, 5) * 0.7;
  finish.apply(ctx, frame, { grain: 0.08, vignette: 0.6, flash });
};
window.sceneReady = true;
