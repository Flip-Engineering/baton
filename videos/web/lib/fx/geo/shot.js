// geo/shot: a small declarative layer over the geo renderers + HUD, keyed to the song's Beats.
//
//   const M = await MapKit.load(B, { THREE, us: true, world: true, spikes: false });
//   const shot = M.shot({
//     layer: 'us', style: 'ember', beats: [8, 18],
//     cam: [[8, { at: 'Detroit', zoom: 3.6 }], [17, { x: 540, y: 380, zoom: 1.02 }]], sy: 900,
//     ignite: { origin: 'Detroit', beats: [8, 17], r: [0, 820], width: 46 },
//     hud: [{ hero: 'lit', caption: 'COUNTIES LIT', settle: 17 }, { callout: 'Chicago', at: 10.5 }],
//   });
//   shot(ctx, t)   // -> { beat, lit, cam, ... }     (M.mark = name => {...} gets a call after each stage, for profiling)
//
// layer: 'us' | 'globe' | 'spikes'. Times in the spec are BEATS; the shot converts with B.spb.
// cam keys take { x, y, zoom } in map px or { at: 'Town' | [lon, lat], zoom }; globe keys take { lon, lat, scale }.
// hud entries (one hero number + at most one secondary per shot):
//   { hero: number | 'lit' | 'km' | 'bases' | (state) => number, caption, from, settle, x, y, size, align, suffix }
//   { callout: 'Town' | [lon, lat], at, text, sub, src }    { reticle: 'Town' | [lon, lat], at, label }
//   { flap: 'TEXT', at, settle, y, size }                    { readout: title, rows, at, src }   { ticker: items }
import { C, clamp, lerp, ease, line } from '../../kit.js';
import { loadGeo, camAt, FLAGS } from './data.js';
import { USMap } from './usmap.js';
import { Globe } from './globe.js';
import { Network } from './network.js';
import { SpikeMap } from './spikes.js';
import { odometer, caption, callout, reticle, splitflap, readout, ticker, fmt, hudBegin } from '../hud.js';

export class MapKit {
  static async load(B, { THREE = null, us = true, world = true, spikes = false, detail = '50m', globe = { cx: 540, cy: 1000, r: 470 }, spikeOpts = {} } = {}) {
    const M = new MapKit(); M.B = B;
    M.geo = await loadGeo({ us, world, detail });
    if (us) { M.us = new USMap(M.geo); M.rail = Network.rail(M.geo, M.us, { arc: 0.12 }); M.grid = Network.grid(M.geo, M.us); }
    if (world) M.globe = new Globe(M.geo, globe);
    if (spikes && THREE) M.spikes = new SpikeMap(M.geo, THREE, spikeOpts);
    if (us) {
      const ll = n => M.geo.us.railTowns[n], P = n => M.us.project(ll(n));
      const [x1, y1] = ll('Chicago').map(v => v * Math.PI / 180), [x2, y2] = ll('Los Angeles').map(v => v * Math.PI / 180);
      const km = 6371 * Math.acos(Math.sin(y1) * Math.sin(y2) + Math.cos(y1) * Math.cos(y2) * Math.cos(x2 - x1));
      const a = P('Chicago'), b = P('Los Angeles'); M.kmPerPx = km / Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    return M;
  }
  // a town by name (largest match) -> { x, y, lon, lat, pop, name }
  city(name) { return this.us.cities.find(c => c.name === name); }
  ll(place) { if (Array.isArray(place)) return place; const c = this.city(place); if (c) return [c.lon, c.lat]; const r = this.geo.us?.railTowns?.[place]; if (r) return r; throw new Error(`MapKit: unknown place ${place}`); }
  camKey(k) { if (k.at == null) return k; const p = this.us.project(this.ll(k.at)); const { at, ...o } = k; return { x: p[0], y: p[1], ...o }; }

  shot(spec) {
    const M = this, B = this.B, spb = B.spb;
    const [b0, b1] = spec.beats || [0, 1e9];
    const camKeys = Array.isArray(spec.cam) ? spec.cam.map(([b, k]) => [b, spec.layer === 'us' ? M.camKey(k) : k]) : spec.cam;
    return (ctx, t, extra = {}) => {
      const beat = B.beat(t), age = (beat - b0) * spb, S = { beat, age, t, b0 };
      if (spec.hudBegin !== false) hudBegin();
      if (spec.bg !== false && spec.bg !== undefined) { ctx.fillStyle = spec.bg; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
      if (spec.layer === 'us') {
        const cam = { sy: spec.sy, ...camAt(camKeys, beat) }; S.cam = cam;
        let ig = null;
        if (spec.ignite) {
          const I = spec.ignite, [i0, i1] = I.beats || [b0, b1], u = clamp((beat - i0) / (i1 - i0));
          const [r0, r1] = I.r || [0, 820];
          ig = { origin: M.ll(I.origin), r: lerp(r0, r1, (I.ease || (x => ease.inCubic(x) * 0.45 + ease.outCubic(x) * 0.55))(u)), width: I.width ?? 46, noise: I.noise, pull: I.pull, heat: I.heat };
        }
        S.ignite = ig;
        const r = M.us.draw(ctx, { cam, t, ignite: ig, style: spec.style || 'ember', ...(spec.map || {}) }); S.lit = r.lit; M.mark?.('map');
        if (spec.network) {
          const N = spec.network, net = typeof N.net === 'string' ? M[N.net] : N.net, [n0, n1] = N.beats || [b0, b1];
          const reveal = ease.inOutCubic(clamp((beat - n0) / (n1 - n0))) * (net.maxD + 30);
          net.draw(ctx, { cam, reveal, t, ...(N.draw || {}) });
          let km = 0; net.e.forEach(([a, b], i) => { const d0 = Math.min(net.d[a], net.d[b]); km += clamp(reveal - d0, 0, net.len[i]); });
          S.km = km * M.kmPerPx; S.kmTotal = net.len.reduce((a, b) => a + b, 0) * M.kmPerPx; S.net = net; M.mark?.('net');
        }
        if (spec.towns) M.us.towns(ctx, { cam, ignite: ig, ...spec.towns });
      } else if (spec.layer === 'globe') {
        const k = camAt(spec.cam, beat), rot = [k.lon ?? 0, k.lat ?? -25, k.tilt ?? 0], scale = k.scale ?? 1; S.rot = rot; S.scale = scale;
        M.globe.draw(ctx, { rot, t, style: spec.style || 'photo', scale, ...(spec.map || {}) }); M.mark?.('globe');
        if (spec.bases) {
          const Bs = spec.bases, [a0] = Bs.beats || [b0];
          S.shown = M.globe.drawBases(ctx, { rot, t, age: (beat - a0) * spb, stagger: Bs.stagger ?? 0.07, scale });
          S.bases = Math.min(M.globe.bases.length, Math.floor(Math.max(0, (beat - a0) * spb) / (Bs.stagger ?? 0.07)) + (beat >= a0 ? 1 : 0));
        }
        if (spec.arcs) {
          const A = spec.arcs, [a0, a1] = A.beats || [b0, b1], home = M.globe.home.ll, n = M.globe.bases.length;
          const arcs = M.globe.bases.map((b, i) => { const s = a0 + (a1 - a0 - 3.5) * i / n, uu = clamp((beat - s) / 3.5);
            return { from: b.ll, to: home, u: ease.inOutCubic(uu), tail: 0.55 + 0.45 * (1 - uu), alpha: uu > 0 ? 1 : 0 }; }).filter(a => a.alpha > 0);
          M.globe.drawArcs(ctx, arcs, { rot, width: 2, scale }); S.home = arcs.filter(a => a.u >= 1).length; M.mark?.('arcs');
        }
      } else if (spec.layer === 'spikes') {
        const k = camAt(spec.cam, beat), sp = M.spikes, R = spec.ripple;
        const ripple = R ? { origin: M.ll(R.origin), r: ease.inOutCubic(clamp((beat - R.beats[0]) / (R.beats[1] - R.beats[0]))) * (R.r || 1700) } : null;
        sp.sky(ctx, spec.sky || {});
        const hero = spec.hero ? { ll: M.ll(spec.hero.place), pop: spec.hero.pop || M.city(spec.hero.place)?.pop, radius: spec.hero.radius || 10 } : null;
        sp.composite(ctx, sp.render({ t, ripple, hero, ...k }), spec.dof || {});
        S.ripple = ripple;
      }
      if (spec.draw) spec.draw(ctx, S, extra);                         // free-form extras between map and HUD
      for (const h of spec.hud || []) drawHud(M, ctx, h, S, spb);
      M.mark?.('hud');
      return S;
    };
  }
}

const VALUES = { lit: S => S.lit, km: S => S.km, bases: S => S.bases, home: S => S.home };
function drawHud(M, ctx, h, S, spb) {
  const { beat } = S, W = ctx.canvas.width;
  if (h.hero != null) {
    const size = h.size || 170, x = h.x ?? 60, y = h.y ?? 400;
    if (h.caption) caption(ctx, h.caption, x, y - size - 20, { align: h.align || 'left', src: h.src, color: h.captionColor || C.red2 });
    let w;
    if (h.settle != null && typeof h.hero === 'number') {
      w = odometer(ctx, null, x, y, { size, align: h.align || 'left', from: h.from ?? 0, to: h.hero, start: (h.start ?? S.b0) * spb, settle: h.settle * spb, now: beat * spb, digits: h.digits || 0, commas: h.commas ?? true, label: h.caption, color: h.color || C.cream, shade: h.shade ?? true });
    } else {
      const f = typeof h.hero === 'function' ? h.hero : VALUES[h.hero] || (() => h.hero);
      let v = f(S) ?? 0; if (h.settle != null && beat >= h.settle && h.final != null) v = h.final(S);
      w = odometer(ctx, h.settle != null && beat >= h.settle ? Math.round(v) : v, x, y, { size, align: h.align || 'left', digits: h.digits || 0, commas: h.commas ?? true, label: h.caption, color: h.color || C.cream, shade: h.shade ?? true });
    }
    if (h.suffix) line(ctx, h.suffix, x + w + 20, y, { family: 'Anton', size: size * 0.47, align: 'left', color: h.suffixColor || 'rgba(244,230,208,0.55)' });
  } else if (h.callout) {
    const age = (beat - h.at) * spb; if (age <= 0 || (h.until != null && beat > h.until)) return;
    const ll = M.ll(h.callout), p = S.cam ? M.us.toScreen(M.us.project(ll), S.cam) : S.rot ? M.globe.at(ll, S.rot, S.scale) : M.spikes.screen(ll, M.spikes.heightOf(M.city(h.callout)?.pop || 0), W, ctx.canvas.height);
    if (!p) return;
    const c = typeof h.callout === 'string' ? M.city(h.callout) : null;
    callout(ctx, p[0], p[1], p[0] + (p[0] < W / 2 ? 110 : -110), p[1] - (h.lift ?? 110), h.text || (typeof h.callout === 'string' ? h.callout.toUpperCase() : ''), age,
      { sub: h.sub === undefined && c ? `POP ${fmt(c.pop)}` : h.sub, src: h.src });
  } else if (h.reticle) {
    const age = (beat - h.at) * spb; if (age <= 0) return;
    const ll = M.ll(h.reticle), p = S.cam ? M.us.toScreen(M.us.project(ll), S.cam) : M.globe.at(ll, S.rot, S.scale);
    reticle(ctx, p[0], p[1], { r: h.r || 56, lock: clamp(age / 0.3), age, label: h.label ?? (typeof h.reticle === 'string' ? h.reticle.toUpperCase() : null) });
  } else if (h.flap) {
    splitflap(ctx, h.flap, (beat - h.at) * spb, h.x ?? W / 2, h.y ?? 1300, { size: h.size || 120, settle: h.settle != null ? (h.settle - h.at) * spb : null, color: h.color || C.cream, seed: h.seed || 7 });
  } else if (h.readout) {
    readout(ctx, h.x ?? 60, h.y ?? 1500, h.readout, typeof h.rows === 'function' ? h.rows(S) : h.rows, (beat - (h.at ?? 0)) * spb, { src: h.src, w: h.w || 520 });
  } else if (h.ticker) ticker(ctx, h.ticker, S.t, h.opts || {});
}
export { FLAGS };
