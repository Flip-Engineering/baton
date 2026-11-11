// AT REST (8 Oct 2026; OBJECTIVE ep. 1; research/series/instrument/ep1_brief.md, the series bible research/series/instrument/BIBLE.md).
// A Prince Rupert's drop hangs in a window polariscope over an American works before dawn. A pendulum striker hits its head and nothing
// changes: its amber-and-black stress fringes hold, and inside its head, as in a lens, the works hangs upside down. The Party's
// Declaration names what the instrument shows. With the analyser out, the drop is clear and calm: Mao's "outward appearance of being at
// rest". Its making shows why it is not. More blows from outside fail. The Executive Chairman: consciousness intervenes only at the site
// of the objective contradictions. A worker's two fingers find the site at the thin tail, and in one unbroken high-speed shot the crack
// front runs up the tail and the form dissolves. The window panel lifts, and the same works stands upright in its own colour at sunrise,
// people walking in through the gate: "Then begins an era of social revolution."
//   0.00-5.14   THE BLOWS: angles A, B, C; contacts 0.40, 2.70, 4.20; cuts on the striker's rebound peaks
//   5.14-17.14  THE CONTRADICTION: the push, 26 -> 15 mm field                                              the Declaration (from 5.57)
//   17.14-18.0  THE SWITCH: the analyser slides out, its edge at the bench's own defocus (60 px)
//   18.0-27.43  THE APPEARANCE OF REST: clear glass, the works sharp inside it                              Mao 1937
//   27.43-34.29 THE MAKING: the blob falls into the tank, the analyser back in, the fringes bloom            The skin sets first. + reading
//   34.29-38.14 MORE BLOWS (35.00; cut 35.80, the heaviest at 36.40)                                        Communist consciousness ...
//   38.14-48.00 THE SITE: the track up the neck and out along the tail; the hand 43.70; the pinch 45.40     ... objective contradictions.
//   48.00-48.15 the tail goes between the pads (b56): only the break is seen; the score has been silent since b55
//   48.15-56.40 THE INSTRUMENT'S CLOCK: one high-speed shot, the front up the tail and through the head; the clock ramps to real time
//               54.60-55.00; the fractured body comes apart into glass                          Mao, the second state + reading
//   56.40-58.90 the empty jaws; the window panel lifts (57.20-58.20); focus racks to the works
//   58.90-66.86 UPRIGHT: the one wide, the one natural colour; nine people walk in to the gate               Marx 1859; the mark at 63.86
// The new asset is the series engine's first instrument, lib/fx/objective/ (research/capabilities/polariscope.md). The score is
// web/audio/songs2/atrest_e.py (songs.py atrest). Nothing here is ported from another series.
// DEPARTURES FROM THE BRIEF (each with its reason) are listed in research/capabilities/polariscope.md, "AT REST as built".
import { buildAtRest } from './atrest.core.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const out = document.getElementById('out').getContext('2d');
let S = await buildAtRest();
window.__atrest = S;
// c20: two of the farm's twelve workers lost their WebGL context at their first frame (their segments came out black under the
// words). If the context is lost, build the scene again on a fresh context and draw the frame again (a few tries).
const lost = () => { try { return S.lr.renderer.getContext().isContextLost(); } catch (e) { return true; } };
window.renderFrame = async t => {
  for (let k = 0; k < 4; k++) {
    if (lost()) { console.log(`atrest: the WebGL context was lost at t ${t}; building again (${k + 1})`);
      try { S.lr.renderer.dispose(); } catch (e) { /* gone */ }
      await new Promise(r => setTimeout(r, 2000 * (k + 1)));
      try { S = await buildAtRest(); window.__atrest = S; } catch (e) { console.log('atrest: rebuild failed ' + (e.message || e)); continue; } }
    await S.frame(t, out);
    if (!lost()) return;
  }
};
ready = true;
