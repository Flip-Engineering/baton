// THE PLANT THAT WOULD NOT DIE (8 Oct 2026; ACP OCTOBER ep. 4; research/october/PLANT_brief.md). A watchman makes his midnight round of a
// closed American plant; wherever his flashlight falls, the 1936 line is running and full of workers (Master Hands, in this piece's night print).
// GM called the 2018 closure of five plants "unallocated": 6,705 jobs by its own count, in a year it netted $8.0 billion. The light is
// capital's watch and it cannot put the line back: the torch goes off and the line runs on; swung, every landing shows more; the breaker
// thrown, the machines run by their own light (Marx's sorcerer, the Manifesto's whole sentence). Then his own eyes open like the
// workers', the torch goes down on the bench as a work lamp, Debs says the rest, and every window is lit: WE OPEN IT.
//   0-4.0     frame 0: one torch disc in the dark, a man at the frame-forming machine inside it, a column's shadow through it with the dust
//             sheet showing in the stripe; the disc slides along the line to two more stations     MIDNIGHT. / THE PLANT IS CLOSED.
//   4.0-6.6   over his shoulder: the bay, the sheeted presses as a row of ghosts; inside his sweep the line runs     “UNALLOCATED”
//   6.6-12.4  the plant from across the lot: the coin of his light bay to bay, each bay lit and staying lit; the push to the centre bay
//   12.4-17.1 the line in his light, whole; the torch dies and the line stays, by its own light (the world persist, the self matte)
//   17.1-21.1 the torch swung: four landings, each showing more (vast, the floor from the gantry, the presses, the chassis line)
//   21.1-23.6 wide: he runs to the main disconnect and hauls it down; every light dies in a run
//   23.6-28.8 the black hall: machines with nobody at them, each by its own light (shafts, gears, flywheel)
//   28.8-30.4 his face, for the first time, lit by the line; his eyes open, calm      30.4 the torch on the bench, a work lamp on living hands
//   32.4-35.0 the crew at the stations where the ghosts were; their eyes open one by one as they work     35.0 every window lit: WE OPEN IT.
//   38.6      the mark
// New shared asset: lib/fx/lantern.js (Lantern + LightMatte; research/capabilities/lantern.md). Engines: reel.js (the night print is the piece's own),
// hero.js + people.js + workforce.js, motion/labour.js (Lever, Stoop), cloth.js (the sheets, baked), objects/press.js, stage.js,
// eyes.js, bands.js, type_world.js (planLoad), kit.js. Plain WebGLRenderer, PCF soft shadows. 60 BPM: beats are seconds.
import * as THREE from 'three';
import { W, H, outCanvas } from '../lib/kit.js';
import { buildPlantScene } from './plant.core.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
const S = await buildPlantScene({ renderer, ctx, glc });
window.__plant = S;
window.renderFrame = async t => S.frame(t);
ready = true;
