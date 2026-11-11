// BY AUTHORITY: the plates made in the page (c20). Two kinds, both through devplate.js plateFromPixels (the bake's own placement on the
// stock's straight line, a run-time glass mask, no depth):
//  - the three new 1919 plates: frames of the same Pathe reel as the baked plates (assets/byauthority/reel/<name>.png, 8-bit sRGB, cut to
//    the picture; assets/byauthority/reel.json records each frame's time and crop), on the silver stock (nitrate_bw);
//  - the 2026 crew: ONE picture of five present-day workers at the start of a shift, from the client's person pipeline, built and lit
//    together in one Cycles scene on the farm (videos/blender/byauthority_crew_job.py: the yard stage's sun, one ground, one wall), saved as
//    assets/byauthority/crew/crew_yard.png and cut here to the 14x17 plate's picture (centred; its crop in crew.json when there is one), on
//    the colour stock (orwocolor). No caption names a person or a job.
// If the crew picture is not in the repo the plate is made from a flat grey field and the page says so in the log ('crew: MISSING'):
// such a render is a review of everything else and is never published.
import { DevPlate, plateFromPixels, loadStock, exists, readBytes, readJSON, decodePNG } from '../lib/fx/devplate.js';
import { SILVER, CREW } from './byauthority.plates.js';

const REEL = new URL('../assets/byauthority/reel/', import.meta.url);
const CREWDIR = new URL('../assets/byauthority/crew/', import.meta.url);
export const CREW_PRINT_LIGHT = 0.5;                                 // logH the crew still is placed above the stock's straight line (see buildCrew)

// a PNG (8 or 16 bit, gray / RGB / RGBA) -> RGBA8, optionally cut to [x0, y0, x1, y1] px
async function rgba8(url, crop = null) {
  const P = await decodePNG(await readBytes(url)), ch = P.channels, sh = P.depth === 16 ? 8 : 0;
  const [x0, y0, x1, y1] = crop || [0, 0, P.width, P.height], w = x1 - x0, h = y1 - y0, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y + y0) * P.width + (x + x0)) * ch, d = (y * w + x) * 4;
    const r = P.data[s] >> sh, g = ch >= 3 ? P.data[s + 1] >> sh : r, b = ch >= 3 ? P.data[s + 2] >> sh : r;
    out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = 255;
  }
  return { data: out, w, h };
}

// the reel plates (SILVER entries with src 'reel'), in the plan's order
export async function buildReel(THREE, box, stock) {
  const out = [];
  for (const [i, p] of SILVER.entries()) {
    if (p.src !== 'reel') continue;
    const I = await rgba8(new URL(p.name + '.png', REEL));
    out.push(await plateFromPixels(THREE, box, p.name, I.data, I.w, I.h, { stock, plate: p.glass, seed: 120 + i, sourceGamma: 1.1, gammaScale: 1.5,
      at: p.at, rot: p.rot, region: p.name, state0: 'negative' }));
  }
  return out;
}

// the crew plate
export async function buildCrew(THREE, box, { log = console.log } = {}) {
  const st = await loadStock('orwocolor'), [gw, gh] = CREW.glass, aspect = (gw - 4) / (gh - 4);
  // printed lighter (c20 finish, 16 Oct): the still's 2-98 % range is placed on the stock's straight line, and a picture that is mostly a
  // mid-grey wall and sand printed there at a mean transmission of 0.08 (the three reel plates print at 0.29-0.33), so in the farm's
  // final 1015-222220 the crew sat under the Chairman as a dim plum slab, faces barely legible. Placing it 0.5 logH higher on the curve is
  // a printer light 0.5 log units (1.7 stops) lighter: mean T 0.27, the older man's face 0.10-0.13, the young woman's 0.3.
  st.straight = st.straight.map(v => v + CREW_PRINT_LIGHT);
  const opts = { at: CREW.at, rot: CREW.rot, region: CREW.name, state0: 'negative' };
  const src = new URL('crew_yard.png', CREWDIR);
  if (await exists(src)) {
    const P = await decodePNG(await readBytes(src)), meta = (await exists(new URL('crew.json', CREWDIR))) ? await readJSON(new URL('crew.json', CREWDIR)) : {};
    // the plate's picture is 14x17 landscape (1.217): the still (1.4) is cut to it about its centre, or where crew.json says
    const ch = P.height, cw = Math.round(ch * aspect), cx = Math.round((meta.cx ?? 0.5) * P.width);
    const x0 = Math.max(0, Math.min(P.width - cw, cx - (cw >> 1)));
    const I = await rgba8(src, meta.crop || [x0, 0, x0 + cw, ch]);
    log(`byauthority: crew plate from crew_yard.png (${P.width}x${P.height}, cut ${I.w}x${I.h})`);
    return [await plateFromPixels(THREE, box, CREW.name, I.data, I.w, I.h, { stock: st, plate: CREW.glass, seed: 61, sourceGamma: 1.0, ...opts })];
  }
  log('byauthority: crew: MISSING (assets/byauthority/crew/crew_yard.png); a grey field stands in: review only, never publish');
  const w = 600, h = Math.round(600 / aspect), d = new Uint8Array(w * h * 4).fill(118); for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return [await plateFromPixels(THREE, box, CREW.name, d, w, h, { stock: st, plate: CREW.glass, seed: 61, ...opts })];
}
