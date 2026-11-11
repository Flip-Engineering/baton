// BY AUTHORITY (AUTHORITY ep. 1; research/series/authority/ep1_brief.md, BIBLE.md): the frame. scenes/byauthority.js makes the canvas
// and the renderer and calls this; web/labs/devplate/byauthority_dry.mjs builds it in node against stubs and runs every frame's logic.
// One contemporary lightbox, overhead (lib/fx/devplate.js Lightbox): the real card (LAC e000008173) at its centre, the stopped city of
// 15 May 1919 beside and under it as silver glass negatives (DevPlate, nitrate_bw: five baked 8 Oct, three made in the page from the same
// reel), the 2026 crew under the card on one colour plate (orwocolor). A plate changes state only by RULE's front (lib/fx/rule.js), shaped
// like the card's edge and scheduled by the permits (byauthority.plates.js ruleSpec): water, then sanction; the crew in the landing.
// The words lie on an acetate strip in the reading band and develop through RULE too (byauthority.type.js). The mark (kit.js closer)
// arrives out of the last frame as the box goes dark, with no sting (the score ends on its own open fourth, after two bars of air).
import * as THREE from 'three';
import { W, H, closer, clamp, loadBrand } from '../lib/kit.js';
import { Rule } from '../lib/fx/rule.js';
import { Lightbox, DevPlate, DevCard, loadStock, readJSON } from '../lib/fx/devplate.js';
import { SILVER, COLOUR, BOX, CARD, LABEL26, FINAL, MARK, PPM, ruleSpec, camAt, lightAt, parAt, toScreen } from './byauthority.plates.js';
import { Words, loadFaces } from './byauthority.type.js';
import { buildReel, buildCrew } from './byauthority.people.js';

const ASSETS = new URL('../assets/devplate/', import.meta.url);

export async function buildScene({ renderer, ctx, glc, dry = false, log = console.log }) {
  await loadBrand();                                                        // the mark's lockup (kit.closer draws from it)
  const spec = ruleSpec();
  const R = new Rule({ regions: spec.regions, reverse: spec.reverse, forward: spec.forward });
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020303);
  const camera = new THREE.OrthographicCamera(-540, 540, 960, -960, 1, 4000);
  const box = new Lightbox(THREE, scene, { size: BOX.size, center: BOX.center, cct: 6500, tint: [0.92, 1.0, 1.04], peak: '#EAF6F8', falloff: 0.10, grain: 0.004, rule: R,
    reflector: { at: [140, 260], size: [900, 600], height: 1300, L: 0.30 }, camH: 700 });
  // the 1919 plates (baked: assets/devplate/bya_*), the card, the words
  const nit = await loadStock('nitrate_bw');
  const plates = [];
  for (const p of SILVER.filter(q => q.src === 'bake')) { PPM[p.name] = (await readJSON(new URL(p.name + '/meta.json', ASSETS))).px_per_mm;
    plates.push(await DevPlate.load(THREE, box, p.name, { at: p.at, rot: p.rot, region: p.name, state0: 'negative', stockObj: nit, gammaScale: 1.5 })); }
  plates.push(...await buildReel(THREE, box, nit));
  const card = await DevCard.load(THREE, box, CARD.name, { at: CARD.at, rot: CARD.rot });
  const words = new Words(await loadFaces());
  // the 2026 crew: one plate from the person pipeline's Cycles still (byauthority.people.js)
  const colour = await buildCrew(THREE, box, { log });
  const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');

  async function frame(t) {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    const tt = Math.min(t, MARK - 1e-4), C = camAt(tt), L = lightAt(tt), pa = parAt(tt);
    box.frame(camera, C, W, H);
    const age = t - MARK, off = t >= MARK ? clamp(1 - age / 0.22) : 1;      // at the mark the box is switched off (0.22 s): the room goes dark
    box.update(tt, camera, { exposure: L.exposure * off, daylight: L.daylight * off, day: { cct: 3300, elev: L.elev, az: 180, I: 2.9 }, fill: L.fill });
    for (const P of plates) P.update(tt, camera, { par: pa && pa.name === P.name ? pa.par : [0, 0] });
    for (const P of colour) P.update(tt, camera);
    card.update(tt, camera, { transmit: L.transmit });
    renderer.setRenderTarget(null); renderer.render(scene, camera);
    { const gl = renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // the frame is finished before the 2D copy
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.drawImage(glc, 0, 0, W, H);
    // the words: the acetate in the reading band; WINNIPEG · 2026 lies on the box over the 2026 plates
    const n = words.draw(ctx, t >= MARK ? MARK - 1e-4 : t, { alpha: 0.95 * off, box: () => { const [x, y] = toScreen(C, LABEL26.at); return { x, y, s: C.k / FINAL.k, rot: -(C.roll || 0) }; } });
    if (t >= MARK) {                                                        // the mark, out of the last frame
      closerG.clearRect(0, 0, W, H); closer(closerG, age);
      ctx.save(); ctx.globalAlpha = clamp(age / 0.18); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
    }
    return { shot: C.shot, k: C.k, roll: C.roll || 0, words: n };
  }
  return { frame, box, plates, card, words, R, camera, scene, colour };
}
