// UNRECOGNIZABLE (research/pieces/UNRECOGNIZABLE.md): the page. unrecognizable.core.js builds the frame; this makes the canvas.
import { outCanvas } from '../lib/kit.js';
import { buildScene } from './unrecognizable.core.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const scene = (location.pathname.split('/').pop() || 'unrecognizable.html').replace(/\.html$/, '');
const ctx = outCanvas();
const S = await buildScene({ ctx, scene });
window.__unrecognizable = S;
window.renderFrame = async t => S.frame(t);
ready = true;
