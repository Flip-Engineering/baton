// THE NIGHT OF 25 OCTOBER (ACP OCTOBER ep. 3). v1: 8 Oct 2026 (96c07bb, published NIGHT_OF_25_OCTOBER_v1). v2: 15 Oct 2026 (c20).
// At 10 a.m. on 25 October 1917 the Provisional Government was declared deposed; it sat on through the night in a dark palace under a
// chandelier bagged in a sheet like a ghost. The government is the ghost; the revolution is the thing that does not die. One pair of clock
// hands carries the night across Eisenstein's October (1928), printed to the night: they land only on the sources' hours, every hour they
// cross is a cut, and at about two in the morning they stop dead and the masses come in on their own time. Then the hour hand turns the
// years over a Dial whose face is the crowd, and the hands stop on 2:00 again in America now: a room at two in the morning, a bare bulb low
// over a table, the people at it lit from below. Then they run again.
// The plan, the takes and every departure from v1: night25.plan.js (header). The frame: night25.core.js. The hands: night25.hands.js.
// The room's plates: night25_room.js (person pipeline), cut into assets/night25/plates/n25_now_*.
// Takes: night25_a.html (v1's order, landing in the room) and night25_b.html (opens in the room at 2:00); ?take= or window.N25_TAKE.
// Engines: reel.js, nightprint.js (the print only; v2 draws no eyes), post.js (the glow, held down), bands.js, kit.js (fonts, the closer).
// Plates: assets/night25/reel.json (picture only; no card, no caption, no sound; the film is credited at the end, as fair dealing asks).
import { W, H } from '../lib/kit.js';
import { Post } from '../lib/fx/post.js';
import { buildNight25 } from './night25.core.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const take = window.N25_TAKE || new URLSearchParams(location.search).get('take') || 'a';
const post = new Post(W, H, { direct: true, glowScale: 0.25 });
const S = await buildNight25({ post, take });
window.__night25 = S;
window.renderFrame = async t => S.frame(t);
ready = true;
