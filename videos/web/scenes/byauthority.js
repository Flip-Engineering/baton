// BY AUTHORITY (AUTHORITY ep. 1, 8 Oct 2026; research/series/authority/ep1_brief.md; the series bible research/series/authority/BIBLE.md).
// Winnipeg, 15 May 1919: in under two hours a whole city stopped, and then its water, bread and milk ran only on the permission of the
// workers' strike committee; the employers themselves walked to the Labor Temple for the committee's card and nailed it to their own
// wagons. Told in the material of that card: the real card (LAC e000008173) on a contemporary lightbox, the stopped city around it as
// glass negatives; whatever the committee permits develops positive behind a front shaped like the card's edge, until the Crown files the
// card as Exhibit 233. It lands in 2026, on the Chairman's line about supremacy in production, over present-day Winnipeg workers
// developing in colour. 84 BPM, 23 bars; the mark at beat 92 (65.714 s). (c20: the Crown's view is cut; its bars went to the turn and the ending.)
//   0-2.857     frame 0: the card glowing on the lightbox (take a: WINNIPEG · 15 MAY 1919; take b: the employers' trip for the card)
//   2.857-17.1  the stopped city: six different 1919 pictures held longer (two plants, two streets, two crowds), negative to negative
//   17.1-20.0   the hinge: one wordless bar; the card comes back, small, among the negatives, and the motif sounds
//   20.0-31.4   WATER, SANCTION (the strikers' own sentence; the seated crowd's faces develop on THE SANCTION)
//   31.4        THE TURN: the one cut that changes state: the card in warm raking daylight      EMPLOYERS OF LABOR …
//   then        Lenin's certificate over the card's words and the Trades and Labor Council's oval, the light climbing
//   landing     the 2026 crew (five workers, one Cycles picture) develops from the edge nearest the card on HAS NOT ACQUIRED, under the
//               Chairman's words; two bars of air pull back to the card above the crew, WINNIPEG · 2026 between them
// The one new asset: DEVPLATE with RULE (lib/fx/devplate.js, lib/fx/rule.js; research/capabilities/devplate.md). The plan (layout,
// schedule, camera, light) is byauthority.plates.js, the words byauthority.type.js, the 2026 plates byauthority.people.js.
// Plain WebGLRenderer, display-referred (no tone map: the plates' own densities are the grade).
import * as THREE from 'three';
import { W, H, outCanvas } from '../lib/kit.js';
import { buildScene } from './byauthority.core.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
const S = await buildScene({ renderer, ctx, glc });
window.__byauthority = S;
window.renderFrame = async t => S.frame(t);
ready = true;
