// LIGHTING c1: the tone-curve chart (critique W7) as a living test. Runs every curve in light/display.js over the colours
// industry is lit by, -3..+8 stops, and writes JSON for tonechart.py to draw.
//   node videos/tools/light/tonechart.mjs > /tmp/x.json && python3 videos/tools/light/tonechart.py /tmp/x.json out.jpg
import { CURVES } from '../../web/lib/fx/light/display.js';
import { blackbody, lampRGB, hexLinear } from '../../web/lib/fx/light/color.js';
const norm = (c, y = 0.18) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map(v => v * y / l); };
const SW = [
  ['house red #c91f37', hexLinear(0xc91f37)],
  ['HPS sodium lamp', norm(lampRGB('hps'), 0.45)],
  ['LPS sodium', norm(lampRGB('lps'), 0.45)],
  ['furnace 1500 K', norm(blackbody(1500).rgb, 0.45)],
  ['molten iron 1800 K', norm(blackbody(1800).rgb, 0.45)],
  ['mercury vapour', norm(lampRGB('mercury'), 0.45)],
  ['welding arc', norm(lampRGB('arc'), 0.45)],
  ['weathered green paint', hexLinear(0x677c5d)],
  ['red-oxide primer', hexLinear(0x8a3a26)],
  ['skin (medium)', hexLinear(0xb98160)],
  ['grey card 18%', [0.18, 0.18, 0.18]],
];
const stops = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const out = { stops, curves: Object.keys(CURVES), swatches: SW.map(s => s[0]), cells: {} };
for (const k of Object.keys(CURVES)) out.cells[k] = SW.map(([, c]) => stops.map(s => CURVES[k](c.map(v => v * 2 ** s)).map(v => Math.round(255 * Math.min(1, Math.max(0, v))))));
console.log(JSON.stringify(out));
