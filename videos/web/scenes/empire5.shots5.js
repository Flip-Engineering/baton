// CIVILIZATION c13, b34-38.3: EXPROPRIATE THE PLANNERS. The working hand rises into the picture the strings were drawn in, takes hold of the gold
// at the exchange's foot and the strings that run from it, closes, and pulls: the puppets drop slack, the exchange is left stripped, and the fist
// is held in silence with light coming out between the knuckles. The hand is the class's; Wall Street is never a hand.
import * as K from './empire5.kit.js';
import { temple } from './empire5.shots1.js';
import { openHand, fist } from './empire5.hand2.js';
const { P, g, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, sg } = K;
const fr = K.frame;

const gstring = (a, c, mid = 0) => { const p = new Path2D(); p.moveTo(a[0], a[1]); p.quadraticCurveTo((a[0] + c[0]) / 2 + mid, (a[1] + c[1]) / 2, c[0], c[1]); g.lineCap = 'round'; strokeP(p, k(1), 16); strokeP(p, d(1), 8); };
export function shotHand(b, t) {
  const age = b - 34;
  if (b >= 36.9) {                                  // the fist, held
    const a = b - 36.9, rays = ease.outCubic(clamp(a / 0.45)) * (1 + 0.06 * Math.sin(a * 9));
    // the exchange, stripped: left up top, off its true, and no strings
    g.save(); g.translate(540, 760); g.rotate(-0.06); g.translate(-540, -760);
    temple(540, 790, 520, 300, { cols: 6, label: 'WALL ST', labelSize: 40 });
    g.restore();
    fist(540, 1390, 640, { rays, t });
    const shake = 1.5 + 8 * clamp((b - 37.0) / 0.6) ** 2;
    return { misreg: 1.6 + 6 * Math.exp(-a * 9), shake, freeze: true, flash: a < 0.05 ? 0.35 : 0 };
  }
  // before: the exchange and its three strings, as at b30-34, a little higher
  const lift = ease.inOutCubic(clamp(age / 0.8)), by = lerp(1290, 1130, lift), tw = lerp(640, 620, lift), th = lerp(360, 350, lift); temple(540, by, tw, th, { cols: 6, label: age > 0.5 ? 'WALL ST' : null, labelSize: 42, flute: false });
  const S = 400, rise = ease.outCubic(clamp(age / 1.0)), curl = fr(b, 35.3, 36.5), pull = ease.inOutCubic(fr(b, 36.2, 36.85));
  const ky = lerp(2180, 1340, rise) - 110 * ease.inOutCubic(curl) + 70 * pull;
  const grab = [540, ky - 0.28 * S * (1 - 0.5 * curl)];
  const heapGone = fr(b, 36.0, 36.6);
  if (heapGone < 1) { g.save(); g.translate(540, by + 4); g.scale(1 - 0.4 * heapGone, 1 - heapGone); g.translate(-540, -by - 4); const hp = new Path2D(); hp.moveTo(230, by + 4); hp.quadraticCurveTo(540, by - 170, 850, by + 4); hp.closePath(); fillP(hp, d(1)); strokeP(hp, k(1), 5); g.restore(); }
  // puppets and their strings: the strings leave the temple's foot until the hand has them, then leave the hand
  const pup = [[200, 'rent', 380], [540, 'factory', 340], [880, 'soldier', 400]], srcT = [[400, by - 8], [540, by - 8], [680, by - 8]];
  pup.forEach(([x, nm, h], i) => {
    const slack = fr(b, 36.85, 37.0), drop = 60 * ease.outCubic(slack), jerk = -34 * Math.sin(Math.PI * clamp((b - 36.2) / 0.65)) * (b < 36.85 ? 1 : 0);
    const y = 1870 + drop + jerk * 0.5, tp = [x, y - h + 24];
    const from = pull > 0.02 ? [lerp(srcT[i][0], grab[0] + (i - 1) * 40, pull), lerp(srcT[i][1], grab[1], pull)] : srcT[i];
    if (b < 36.85) gstring(from, tp, 0); else gstring([grab[0] + (i - 1) * 40, grab[1] + 120], [x, tp[1] + 120], (i - 1) * 60);
    sg(nm, x, y, h, k(1), { lod: 2 });
  });
  openHand(540, ky, S, curl, { t });
  return { misreg: 1.6 + 4 * Math.exp(-age * 7), flash: age < 0.05 ? 0.2 : 0 };
}
