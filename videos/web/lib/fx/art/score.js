// ART kit / SCORE (cycle 2, change C): the song drives the cut. An event score built from the MEASURED onsets of the
// exact wav the build muxes (web/lib/fx/art/framecheck.py onsets <wav> --json score.json), never from a hand list.
//
//   import { Score } from '../lib/fx/art/score.js';
//   const sc = await Score.load(url);               // or new Score(json)
//   sc.accents / sc.beats / sc.pickups              // [t...] in song time
//   sc.frame(t)                                     // Math.round(t * 30)
//   sc.near(t, cls, win)                            // the event of class cls within win seconds, or null
//   sc.rel(t, hit)                                  // frames since the hit (negative before)
// Direction (brief §3C): an ACCENT wants a picture act you feel (a cut on the strike, a pour surge with an exposure jump,
// an impact frame, an eruption); a BEAT a lighter one (a camera kick on ones, a spark burst across the lens, a smear, a
// second-angle repeat); a PICKUP a few frames of anticipation. Keep source motion running between hits unless a hold is
// the point. A word never carries a hit alone: it is struck on the same frame as the picture act, never before. Whether
// it lands is judged by watching the clip with its sound.
export class Score {
  constructor(json, { fps = 30 } = {}) {
    this.fps = fps; this.src = json.wav; this.events = json.events.filter(e => e.class !== 'none');
    this.accents = this.events.filter(e => e.class === 'ACCENT').map(e => e.t);
    this.beats = this.events.filter(e => e.class === 'BEAT').map(e => e.t);
    this.pickups = this.events.filter(e => e.class === 'PICKUP').map(e => e.t);
  }
  static async load(url, o) { return new Score(await (await fetch(url)).json(), o); }
  frame(t) { return Math.round(t * this.fps); }
  rel(t, hit) { return Math.round((t - hit) * this.fps); }
  near(t, cls = null, win = 0.02) { return this.events.find(e => (!cls || e.class === cls) && Math.abs(e.t - t) <= win) || null; }
}
