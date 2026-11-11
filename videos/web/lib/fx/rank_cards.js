// RANK CARDS (LOOKS studio, cycle 2): a ranks.js crowd composed ONCE per shot, then animated as cards.
//
// Why: composing the ranks costs 6-14 s a frame on this machine (thousands of instanced silhouettes, per-rank canvas
// passes and a per-pixel aux loop). A 2 s crowd clip was 10-17 minutes. Every crowd painter and every stage director
// treats a rank as a unit anyway (Deineka's registers, Gavras rehearsing blocks, not extras): so a rank is a card.
// Each card is composed per POSE STATE (standing, cocked, struck), and a frame is a few drawImage calls: the back
// plate, then the cards far to near at their own offset, lean and scale; the aux is rebuilt the same way from
// per-rank stamps at aux resolution (nearest sampling, binary alpha, so depth and class stay exact).
//
//   import { RankCards } from '../lib/fx/rank_cards.js';
//   const cards = await RankCards.build(R, crowd, { back, sun, style, states: { stand: t0, cock: hitT - 2/30, hit: hitT + 3/30 } });
//   const { aux } = cards.frame(ctx, { cards: [{ dx, dy, k, lean, state }, ...], back: { k, dx, dy } });
//   lk.source({ color: canvas, aux, depth: [1, Math.E ** 4], ranks: { n: cards.n }, sky: 'designed' });
//   lk.apply(ctx2, 'KLUTSIS', t, { rankOff: cards.offsets() });   // the print's screens ride on the cards
//
// Cost: ~1-3 ms per card per frame for the colour plus the aux stamps; the build is one compose per state.
import { RANK_STYLES } from './ranks.js';
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

export class RankCards {
  static async build(R, crowd, { back, sun, style = 'dusk', states = { stand: 0 }, bands = true, auxW = 540, auxH = 960 } = {}) {
    const c = new RankCards(); c.W = R.W; c.H = R.H; c.aw = auxW; c.ah = auxH; c.n = crowd.ranks.length; c.t0 = performance.now();
    const tmp = mk(R.W, R.H), tg = tmp.getContext('2d');
    c.cards = {};
    let gy0 = null;
    const st = typeof style === 'object' ? style : RANK_STYLES[style];
    for (const [name, ts] of Object.entries(states)) {
      tg.clearRect(0, 0, R.W, R.H);
      const res = R.compose(tg, crowd, ts, { back: null, sun, style, gap: false });
      gy0 = res.groundY;
      c.cards[name] = res.layers.map((L, ri) => {
        if (!L) return null;
        const col = mk(R.W, R.H), g = col.getContext('2d');
        // the contact band: a solid strip under each figure's feet (the rank stands ON the plate; no comb of cast shadows)
        const figs = crowd.ranks[ri].figs || [];
        if (bands && figs.length) { g.fillStyle = st.ink[Math.min(ri, st.ink.length - 1)]; for (const f of figs) g.fillRect(f.x - f.h * 0.15, f.y - f.h * 0.012, f.h * 0.3, f.h * 0.04); }
        g.drawImage(L.figs, 0, 0); if (L.flags) g.drawImage(L.flags, 0, 0);
        // aux stamp: depth flat per rank, class 255 figures (and the band), 180 flags; alpha binary
        const a = mk(auxW, auxH), ag = a.getContext('2d', { willReadFrequently: true });
        const sc = mk(auxW, auxH), sg = sc.getContext('2d', { willReadFrequently: true });
        const im = ag.createImageData(auxW, auxH), D = im.data, l = Math.round(65534 * c.dOf(ri));
        const put = (cv, cls, thr) => { sg.clearRect(0, 0, auxW, auxH); sg.drawImage(cv, 0, 0, auxW, auxH); const A = sg.getImageData(0, 0, auxW, auxH).data;
          for (let j = 0; j < auxW * auxH; j++) if (A[j * 4 + 3] > thr) { D[j * 4] = l >> 8; D[j * 4 + 1] = l & 255; D[j * 4 + 2] = cls; D[j * 4 + 3] = 255; } };
        put(col, 255, 110); if (L.flags) put(L.flags, 180, 110);
        ag.putImageData(im, 0, 0);
        const fr = figs.length ? { x: figs.reduce((s, f) => s + f.x, 0) / figs.length, y: Math.max(...figs.map(f => f.y)) } : { x: R.W / 2, y: L.foot || R.H };
        return { col, aux: a, pivot: [fr.x, fr.y], foot: L.foot, h: L.h };
      });
    }
    // the back plate (sky + ground, no figures) and its aux (ground depth between the foot lines, sky beyond)
    c.back = mk(R.W, R.H); const bg = c.back.getContext('2d');
    R.compose(bg, { ranks: [], seed: 0 }, 0, { back, sun, style, ground: { y0: gy0 } });
    const ga = R.aux(crowd, [], gy0, { w: auxW, h: auxH }); c.backAux = mk(auxW, auxH); c.backAux.getContext('2d').drawImage(ga, 0, 0);
    c.color = mk(R.W, R.H); c.auxC = mk(auxW, auxH);
    c.buildMs = performance.now() - c.t0;
    return c;
  }
  dOf(ri) { return 0.12 + 0.62 * ri / Math.max(1, this.n - 1); }   // ranks.js aux depth per rank
  // spec: { cards: [{ dx, dy, k, lean, state }] per rank (px, y down; k scale about the rank's foot centre; lean in rad
  //   as a shear about the foot line), back: { k, dx, dy } }. Draws into ctx (and this.color) and returns { aux }.
  frame(ctx, spec = {}) {
    const t0 = performance.now(), W = this.W, H = this.H, cs = spec.cards || [], b = spec.back || {};
    const g = this.color.getContext('2d'), a = this.auxC.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    a.setTransform(1, 0, 0, 1, 0, 0); a.imageSmoothingEnabled = false; a.clearRect(0, 0, this.aw, this.ah);
    const sx = this.aw / W, bk = b.k || 1;
    const place = (G, s, k, px, py, dx, dy, lean) => { G.setTransform(k * s, 0, -lean * k * s, k * s, (px * (1 - k) + dx + lean * k * py) * s, (py * (1 - k) + dy) * s); };
    place(g, 1, bk, W / 2, H / 2, b.dx || 0, b.dy || 0, 0); g.drawImage(this.back, 0, 0);
    place(a, sx, bk, W / 2, H / 2, b.dx || 0, b.dy || 0, 0); a.drawImage(this.backAux, 0, 0, W, H);
    this._off = [];
    for (let ri = this.n - 1; ri >= 0; ri--) {
      const q = cs[ri] || {}, set = this.cards[q.state || Object.keys(this.cards)[0]] || this.cards[Object.keys(this.cards)[0]], C = set[ri];
      if (!C) continue;
      const k = q.k || 1, dx = q.dx || 0, dy = q.dy || 0, lean = q.lean || 0, [px, py] = C.pivot;
      place(g, 1, k, px, py, dx, dy, lean); g.drawImage(C.col, 0, 0);
      place(a, sx, k, px, py, Math.round(dx * sx) / sx, Math.round(dy * sx) / sx, lean); a.drawImage(C.aux, 0, 0, W, H);
      this._off[ri] = [dx + px * (1 - k), dy + py * (1 - k)];
    }
    g.setTransform(1, 0, 0, 1, 0, 0); a.setTransform(1, 0, 0, 1, 0, 0);
    if (ctx) { ctx.drawImage(this.color, 0, 0); }
    this.ms = performance.now() - t0;
    return { aux: this.auxC, color: this.color, ms: this.ms };
  }
  // per-rank screen offsets for looks.js (o.rankOff): the print's dots ride with each card
  offsets() { return (this._off || []).map(v => v || [0, 0]); }
}
