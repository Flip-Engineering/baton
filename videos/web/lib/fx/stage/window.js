// STAGE / window (CAMERA7 c3 iteration 2): a window as ONE physical emitter. Pure JS (no three): runs in the page, in node and writes the
// emitter's image for Cycles (labs/human8/camera7_export.mjs).
//
// Until this iteration a window@7 was three things that agreed only by hand: a directional light (lux), an environment patch (a quarter of the
// radiance) and a background lamp placed to give the wall a gradient. A window is a rectangle of sky at a distance with a radiance: the light on
// the face, the shadow's edge, the window in the cornea, the sheen on the skin and the light on the wall behind are all that one rectangle.
//   key.window = { width_m, height_m, distance (m, from the head), head [x, y, z] (the point the key's direction is measured from),
//                  panes { nx, ny, bar_m, dark } (the mullions: nx x ny panes, bars bar_m wide, transmitting 1 - dark),
//                  vgrad [bottom, top] (the sky's luminance over the glass), tintBot / tintTop (rgb multipliers: the sky's colour) }
//   key.elevation / azimuth / lux / kelvin: where it is and the illuminance it gives a surface that faces it at the head (what a lux meter reads).
// windowEmitter(key) -> the rectangle (centre, axes, normal toward the sitter), its radiance L(ux, uy) in cd/m2 per channel such that the
// irradiance at the head is key.lux x kelvin(key.kelvin) by construction (the emitter's L0 is DERIVED from the lux, not chosen), the irradiance
// anywhere (numerical, Lambert's cosines and the inverse square: the wall behind the sitter, the floor), and the image Cycles reads.
// The engine keeps its directional key (the shadow map, the soft key by sub-frame jitter, the cornea's analytic disc: one angle, one lux) for
// the face; what a finite window adds is the light on the surfaces that are not the face, and wallRatio() gives it to the wall as a field.
import { sunDirection } from '../light/sky.js';
import { kelvin } from '../light/color.js';

const D = Math.PI / 180;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const EDGE_M = 0.004;   // the mullions' edges are 4 mm soft (a painted bevel, and the cornea's mirror is a few px across)

export function windowEmitter(key) {
  const Wd = key && key.emitter && key.window; if (!Wd) return null;
  const head = Wd.head ?? [0, 1.55, 0], d = sunDirection(key.elevation, key.azimuth), az = key.azimuth * D;
  const r = [Math.cos(az), 0, Math.sin(az)], u = cross(d, r), n = d.map(v => -v);
  const w = Wd.width_m, h = Wd.height_m, dist = Wd.distance, c = head.map((v, i) => v + d[i] * dist);
  const P = Wd.panes || { nx: 1, ny: 1, bar_m: 0, dark: 0 }, vg = Wd.vgrad || [1, 1], tb = Wd.tintBot || [1, 1, 1], tt = Wd.tintTop || [1, 1, 1];
  // transmission of the frame (1 in the panes): vertical mullions between the nx panes, transoms between the ny
  const bars = (ux, uy) => {
    let q = 9;
    for (let a = 1; a < P.nx; a++) q = Math.min(q, Math.abs(ux * w / 2 - (-w / 2 + w * a / P.nx)));
    for (let a = 1; a < P.ny; a++) q = Math.min(q, Math.abs(uy * h / 2 - (-h / 2 + h * a / P.ny)));
    return 1 - (P.dark ?? 0.85) * sm(P.bar_m / 2 + EDGE_M, P.bar_m / 2 - EDGE_M, q);
  };
  // the sky seen through the glass (relative): brighter overhead, bluer overhead (a window's sky is not uniform)
  const sky = (ux, uy) => { const vt = (Math.min(1, Math.max(-1, uy)) + 1) / 2, g = vg[0] + (vg[1] - vg[0]) * vt; return [0, 1, 2].map(i => g * (tb[i] + (tt[i] - tb[i]) * vt)); };
  const pos = (ux, uy) => [c[0] + r[0] * ux * w / 2 + u[0] * uy * h / 2, c[1] + r[1] * ux * w / 2 + u[1] * uy * h / 2, c[2] + r[2] * ux * w / 2 + u[2] * uy * h / 2];
  // irradiance (rgb) at p on a surface with normal nrm from the rectangle at unit L0: sum over cells of L cos(theta_w) cos(theta_p) dA / r^2
  const irr1 = (p, nrm, nu, nv, withBars) => {
    const E = [0, 0, 0], dA = (w / nu) * (h / nv);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const ux = -1 + (i + 0.5) * 2 / nu, uy = -1 + (j + 0.5) * 2 / nv, x = pos(ux, uy), v = [p[0] - x[0], p[1] - x[1], p[2] - x[2]];
      const r2 = dot(v, v), rr = Math.sqrt(r2), cw = dot(n, v) / rr, cp = -dot(nrm, v) / rr; if (cw <= 0 || cp <= 0) continue;
      const f = dA * cw * cp / r2 * (withBars ? bars(ux, uy) : 1), s = sky(ux, uy); E[0] += s[0] * f; E[1] += s[1] * f; E[2] += s[2] * f;
    }
    return E;
  };
  // L0 per channel: derived from the lux at the head, with the bars in (a fine grid: the bars are 4 cm and the grid 1 cm)
  const rgbLux = kelvin(key.kelvin ?? 5600).map(v => v * key.lux), Eh = irr1(head, d, 90, 120, true), Es = irr1(head, d, 90, 120, false);
  const L0 = [0, 1, 2].map(i => rgbLux[i] / Eh[i]), Tbar = [0, 1, 2].map(i => Eh[i] / Es[i]);
  const radiance = (ux, uy) => { const s = sky(ux, uy), b = bars(ux, uy); return [0, 1, 2].map(i => L0[i] * s[i] * b); };
  // the omega the glass subtends at the head (the key's solid angle, for the notes), and its luminance (cd/m2) with the bars
  const E = {
    c, r, u, n, d, w, h, dist, head, panes: P, rgbLux, L0, Tbar, bars, sky, radiance, pos,
    // irradiance (rgb lux) at p on a surface with normal nrm: the coarse grid on the smooth sky times the bars' mean transmission (the bars are far below a pixel from 3 m)
    irradiance(p, nrm, { nu = 24, nv = 32, exact = false } = {}) {
      if (exact) { const e = irr1(p, nrm, 90, 120, true); return [0, 1, 2].map(i => e[i] * L0[i]); }
      const e = irr1(p, nrm, nu, nv, false); return [0, 1, 2].map(i => e[i] * L0[i] * Tbar[i]);
    },
    // the image Cycles reads (Float32 RGBA, cd/m2, row 0 = the bottom of the glass, column 0 = ux -1): 3 x 3 supersampled
    image({ W = 192, H = 256 } = {}) {
      const data = new Float32Array(W * H * 4), S = 3;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const o = [0, 0, 0];
        for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) { const L = radiance(-1 + (i + (a + 0.5) / S) * 2 / W, -1 + (j + (b + 0.5) / S) * 2 / H); o[0] += L[0]; o[1] += L[1]; o[2] += L[2]; }
        const k = (j * W + i) * 4; data[k] = o[0] / (S * S); data[k + 1] = o[1] / (S * S); data[k + 2] = o[2] / (S * S); data[k + 3] = 1;
      }
      return { data, W, H };
    },
    // the solid angle of the glass at the head (sr; the frame's bars not subtracted) and its mean luminance with them (cd/m2)
    solid() { let om = 0; const nu = 60, nv = 80, dA = (w / nu) * (h / nv); for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const x = pos(-1 + (i + 0.5) * 2 / nu, -1 + (j + 0.5) * 2 / nv), v = [head[0] - x[0], head[1] - x[1], head[2] - x[2]], rr = Math.hypot(...v); om += dA * Math.max(0, dot(n, v) / rr) / (rr * rr); } return om; },
  };
  E.record = () => ({ centre: c, right: r, up: u, normal: n, w, h, image: 'window_r7_emit.hdr', imageW: 192, imageH: 256, head, distance: dist });
  return E;
}

// the wall behind the sitter (z = -back, normal +z) as the engine lights it: the directional key gives the wall E_dir = lux x max(0, d.n), the same everywhere; the window gives
// E_win(x, y). wallRatio(key, back) returns f(x, y) -> rgb = E_win / E_dir, the factor the wall's colour takes so that the engine's wall receives what the rectangle gives it.
export function wallRatio(key, back) {
  const W = windowEmitter(key); if (!W) return null;
  const nrm = [0, 0, 1], cos = Math.max(0, dot(W.d, nrm)), Ed = W.rgbLux.map(v => v * cos); if (cos < 1e-3) return null;
  return (x, y) => { const e = W.irradiance([x, y, -back], nrm); return [0, 1, 2].map(i => e[i] / Ed[i]); };
}
