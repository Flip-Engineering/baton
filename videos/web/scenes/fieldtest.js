// dev harness: cycles the four new fields (globe, pour, skyline, crowd) for stills; song borrowed from productive
import { W, H, outCanvas } from '../lib/kit.js';
import { Heat, FIELD as F, PAL as P } from '../lib/heat.js';
const ctx = outCanvas(); const heat = new Heat(0.5);
window.renderFrame = async (t) => {
  const k = Math.floor(t) % 8, f = [F.globe, F.globe, F.pour, F.pour, F.skyline, F.skyline, F.crowd, F.crowd][k];
  heat.draw(ctx, t, { field: f, pal: k % 2 ? P.infrared : P.ironbow, aux: (t % 2) / 2 * 0.8 + 0.1 });
};
window.sceneReady = true;
